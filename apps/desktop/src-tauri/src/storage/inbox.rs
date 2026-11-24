// Remote mirror and durable outbound journal. Never delete while requests are unresolved.
use super::{sqlite::{Connection,Transaction},tasks::{TaskOwner,TaskError},StorageError};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Page {pub contract_version:u32,pub items:Vec<Change>,pub next_cursor:String,pub has_more:bool}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Change {pub position:String,pub entity:String,pub entity_id:String,pub revision:i64,pub deleted:bool,pub snapshot:Value}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Status {pub cursor:String,pub records:u64}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Difference {pub entity:String,pub id:String,pub title:String,pub state:String,pub local:Option<Value>,pub cloud:Value,pub deleted:bool,pub local_digest:String,pub cloud_digest:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Comparison {pub items:Vec<Difference>,pub total:usize,pub has_more:bool}
fn bad()->TaskError{TaskError::InvalidInput}
fn id(s:&str)->Option<String>{if s.len()!=32 && !(s.len()==36 && s.bytes().enumerate().all(|(i,b)|if [8,13,18,23].contains(&i){b==b'-'}else{b.is_ascii_hexdigit()})){return None}let v=s.replace('-',"");(v.len()==32&&v!="0".repeat(32)&&v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))).then_some(v)}
fn cursor(s:&str,owner:&TaskOwner)->Result<(String,i64),TaskError>{
 let parts:Vec<_>=s.split('.').collect();if parts.len()!=3||parts[0].len()!=32||id(parts[0]).is_none()||parts[1]!=owner.user_id.replace('-',""){return Err(bad())}
 let pos:i64=parts[2].parse().map_err(|_|bad())?;if pos<0||pos.to_string()!=parts[2]{return Err(bad())}Ok((parts[0].into(),pos))
}
pub(super) fn open(path:&Path)->Result<Connection,TaskError>{
 let parent=path.parent().ok_or(StorageError::Unavailable)?;std::fs::create_dir_all(parent).map_err(|_|StorageError::Unavailable)?;
 let db=Connection::open(&parent.join("cloud-inbox.sqlite3"))?;
 db.execute("PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;")?;
 let tx=Transaction::begin(&db)?;
 let version=db.scalar("PRAGMA user_version")?;let app=db.scalar("PRAGMA application_id")?;
 if version=="0"&&app=="0" {
  if db.scalar("SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")?!="0"{return Err(StorageError::InvalidSchema.into())}
  db.execute("CREATE TABLE inbox_state(project TEXT NOT NULL,user_id TEXT NOT NULL,cursor TEXT NOT NULL,PRIMARY KEY(project,user_id));
  CREATE TABLE inbox_records(project TEXT NOT NULL,user_id TEXT NOT NULL,entity TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,deleted INTEGER NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(project,user_id,entity,id));
  PRAGMA application_id=1296389193; PRAGMA user_version=1;")?;
 }else if !matches!(version.as_str(),"1"|"2"|"3"|"4"|"5")||app!="1296389193"{return Err(StorageError::InvalidSchema.into())}
 if !matches!(version.as_str(),"2"|"3"|"4"|"5") {db.execute("CREATE TABLE outbound(project TEXT NOT NULL,user_id TEXT NOT NULL,entity TEXT NOT NULL,id TEXT NOT NULL,operation TEXT NOT NULL,expected INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project,user_id,entity,id)); PRAGMA user_version=2;")?;}
 if !matches!(version.as_str(),"3"|"4"|"5") {db.execute("ALTER TABLE outbound ADD COLUMN action TEXT NOT NULL DEFAULT 'update'; UPDATE outbound SET action='create' WHERE expected=0; ALTER TABLE outbound ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'; PRAGMA user_version=3;")?;}
 if !matches!(version.as_str(),"4"|"5") {db.execute("CREATE TABLE sync_control(project TEXT NOT NULL,user_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,caught_up INTEGER NOT NULL DEFAULT 0,recovering TEXT NOT NULL DEFAULT '',PRIMARY KEY(project,user_id)); PRAGMA user_version=4;")?;}
 if version!="5"{db.execute("ALTER TABLE sync_control ADD COLUMN receiving INTEGER NOT NULL DEFAULT 0; ALTER TABLE sync_control ADD COLUMN merge_backup TEXT NOT NULL DEFAULT ''; CREATE TABLE sync_conflicts(project TEXT NOT NULL,user_id TEXT NOT NULL,entity TEXT NOT NULL,id TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(project,user_id,entity,id)); PRAGMA user_version=5;")?;}
 tx.commit()?;Ok(db)
}
fn state(db:&Connection,o:&TaskOwner)->Result<Status,TaskError>{
 let rows=db.query("SELECT cursor FROM inbox_state WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?;
 let count=db.query("SELECT count(*) FROM inbox_records WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?;
 Ok(Status{cursor:rows.first().map(|r|r[0].clone()).unwrap_or_default(),records:count[0][0].parse().map_err(|_|bad())?})
}
pub fn status(path:&Path,o:&TaskOwner)->Result<Status,TaskError>{o.validate()?;state(&open(path)?,o)}
fn fields(kind:&str)->Result<&'static [&'static str],TaskError>{Ok(match kind{
 "task"=>&["title","completed","projectId","dueDate","priority"],"note"|"project"=>&["title","body","state","pinned"],
 "goal"=>&["title","description","state","targetDate","progress"],"event"=>&["title","details","eventDate","startTime","endTime"],
 "finance"=>&["title","direction","category","amountCents","entryDate","currency"],"budget"=>&["month","category","limitCents","currency"],_=>return Err(bad())})}
pub(super) fn canonical(kind:&str,p:&Value)->Result<Value,TaskError>{
 if !p.is_object(){return Err(bad())}let mut result=serde_json::Map::new();
 for &key in fields(kind)? {
  let default=if kind=="task"&&key=="priority"{json!(0)}else{Value::Null};
  let v=if kind=="task"&&matches!(key,"priority"|"projectId"|"dueDate"){p.get(key).unwrap_or(&default)}else{p.get(key).ok_or_else(bad)?};
  let v=if matches!(key,"completed"|"pinned"){json!(v.as_bool().ok_or_else(bad)?)}
   else if matches!(key,"priority"|"progress"|"amountCents"|"limitCents"){
    let n=v.as_i64().ok_or_else(bad)?;let(max,min)=match key{"priority"=>(3,0),"progress"=>(100,0),_=>(999999999999,1)};if n<min||n>max{return Err(bad())}json!(n)
   }else if v.is_null()&&matches!(key,"projectId"|"dueDate"|"targetDate"|"startTime"|"endTime"){Value::Null}
   else{let s=v.as_str().ok_or_else(bad)?;if s.len()>80000||s.contains('\0'){return Err(bad())}if key=="projectId"{json!(id(s).ok_or_else(bad)?)}else{json!(s)}};
  result.insert(key.into(),v);
 }Ok(Value::Object(result))
}
pub fn stage(path:&Path,o:&TaskOwner,expected:&str,page:Page)->Result<Status,TaskError>{
 o.validate()?;if page.contract_version!=1||page.items.len()>100||page.items.is_empty()&&page.has_more{return Err(bad())}
 let(next_epoch,next)=cursor(&page.next_cursor,o)?;
 let mut pos=if expected.is_empty(){0}else{let(epoch,p)=cursor(expected,o)?;if epoch!=next_epoch{return Err(TaskError::Conflict)}p};
 let db=open(path)?;let tx=Transaction::begin(&db)?;
 if state(&db,o)?.cursor!=expected{return Err(TaskError::Conflict)}
 for item in &page.items {
  if pos==i64::MAX{return Err(bad())}pos+=1;if item.position!=pos.to_string()||item.revision<1||item.revision>9007199254740991{return Err(bad())}
  let key=id(&item.entity_id).ok_or_else(bad)?;
  if item.snapshot.get("id").and_then(Value::as_str).and_then(id)!=Some(key.clone())||item.snapshot.get("revision").and_then(Value::as_i64)!=Some(item.revision)
   || item.snapshot.get("deletedAt").is_none()||item.deleted!=!item.snapshot["deletedAt"].is_null(){return Err(bad())}
  canonical(&item.entity,&item.snapshot)?;
  let data=serde_json::to_string(&item.snapshot).map_err(|_|bad())?;if data.len()>131072{return Err(bad())}
  let old=db.query("SELECT revision FROM inbox_records WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,&item.entity,&key])?;
  if old.first().is_some_and(|r|r[0].parse::<i64>().map_or(true,|r|r>=item.revision)){return Err(TaskError::Conflict)}
  db.query("INSERT INTO inbox_records VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(project,user_id,entity,id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted,snapshot=excluded.snapshot",&[&o.project_ref,&o.user_id,&item.entity,&key,&item.revision.to_string(),if item.deleted{"1"}else{"0"},&data])?;
 }
 if pos!=next{return Err(bad())}
 if state(&db,o)?.records>20000{return Err(bad())}
 db.query("INSERT INTO inbox_state VALUES(?1,?2,?3) ON CONFLICT(project,user_id) DO UPDATE SET cursor=excluded.cursor",&[&o.project_ref,&o.user_id,&page.next_cursor])?;
 db.query("INSERT INTO sync_control(project,user_id,caught_up) VALUES(?1,?2,CASE WHEN ?3='0' THEN unixepoch() ELSE 0 END) ON CONFLICT(project,user_id) DO UPDATE SET caught_up=excluded.caught_up",&[&o.project_ref,&o.user_id,if page.has_more{"1"}else{"0"}])?;
 let result=state(&db,o)?;tx.commit()?;Ok(result)
}
pub(super) fn local(db:&Connection,o:&TaskOwner,kind:&str,key:&str,cloud:&Value)->Result<Option<Value>,TaskError>{
 let sql=match kind{
 "task"=>"SELECT t.title,t.completed,COALESCE(a.project_id,''),COALESCE(a.due_date,''),COALESCE(a.priority,0) FROM tasks t LEFT JOIN task_attributes a ON a.task_id=t.id WHERE t.project_ref=?1 AND t.user_id=?2 AND t.id=?3",
 "note"=>"SELECT title,body,state,pinned FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 AND id=?3 AND kind='note'",
 "project"=>"SELECT title,body,state,pinned FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 AND id=?3 AND kind='project'",
 "goal"=>"SELECT title,description,state,COALESCE(target_date,''),progress FROM goals WHERE project_ref=?1 AND user_id=?2 AND id=?3",
 "event"=>"SELECT title,details,event_date,COALESCE(start_time,''),COALESCE(end_time,'') FROM calendar_events WHERE project_ref=?1 AND user_id=?2 AND id=?3",
 "finance"=>"SELECT title,kind,category,amount_cents,entry_date,'TRY' FROM finance_entries WHERE project_ref=?1 AND user_id=?2 AND id=?3",
 "budget"=>"SELECT month,category,limit_cents,'TRY' FROM finance_budgets WHERE project_ref=?1 AND user_id=?2 AND month=?3 AND category=?4",_=>return Err(bad())};
 let rows=if kind=="budget"{db.query(sql,&[&o.project_ref,&o.user_id,cloud["month"].as_str().ok_or_else(bad)?,cloud["category"].as_str().ok_or_else(bad)?])?}else{db.query(sql,&[&o.project_ref,&o.user_id,key])?};
 let Some(row)=rows.first()else{return Ok(None)};let mut p=serde_json::Map::new();
 for(&field,value)in fields(kind)?.iter().zip(row){let v=if matches!(field,"completed"|"pinned"){json!(value=="1")}else if matches!(field,"priority"|"progress"|"amountCents"|"limitCents"){json!(value.parse::<i64>().map_err(|_|bad())?)}else if value.is_empty()&&matches!(field,"projectId"|"dueDate"|"targetDate"|"startTime"|"endTime"){Value::Null}else{json!(value)};p.insert(field.into(),v);}
 Ok(Some(canonical(kind,&Value::Object(p))?))
}
pub fn compare(path:&Path,o:&TaskOwner,offset:u32)->Result<Comparison,TaskError>{
 o.validate()?;if offset>20000{return Err(bad())}let cache=open(path)?;let cache_tx=Transaction::begin(&cache)?;
 let total=state(&cache,o)?.records as usize;
 let rows=cache.query("SELECT entity,id,deleted,snapshot FROM inbox_records WHERE project=?1 AND user_id=?2 ORDER BY entity,id LIMIT 50 OFFSET ?3",&[&o.project_ref,&o.user_id,&offset.to_string()])?;let(db,_)=super::connect(path)?;let tx=Transaction::begin(&db)?;let mut items=Vec::new();
 for r in rows.into_iter(){let snapshot:Value=serde_json::from_str(&r[3]).map_err(|_|bad())?;let cloud=canonical(&r[0],&snapshot)?;let local=local(&db,o,&r[0],&r[1],&cloud)?;let deleted=r[2]=="1";
 let state=if deleted{if local.is_some(){"cloudDeleted"}else{"absentBoth"}}else{match &local{None=>"onlyCloud",Some(v)if *v==cloud=>"same",_=>"different"}};
 let local_digest=digest(&json!(local))?;let cloud_digest=digest(&snapshot)?;
 items.push(Difference{local_digest,cloud_digest,entity:r[0].clone(),id:r[1].clone(),title:cloud.get("title").or_else(||cloud.get("category")).and_then(Value::as_str).unwrap_or("").into(),state:state.into(),local,cloud,deleted});}
 tx.commit()?;cache_tx.commit()?;Ok(Comparison{items,total,has_more:total>offset as usize+50})
}

#[cfg(test)]
mod tests {
 use super::*;
 static NEXT:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);
 struct Temp(std::path::PathBuf);
 impl Temp{fn new()->Self{let p=std::env::temp_dir().join(format!("metis-inbox-{}-{}-{}",std::process::id(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&p).unwrap();Self(p)}fn db(&self)->std::path::PathBuf{self.0.join("local.sqlite3")}}
 impl Drop for Temp{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
 fn owner()->TaskOwner{TaskOwner{project_ref:"test-project".into(),user_id:"11111111-1111-4111-8111-111111111111".into()}}
 fn page(o:&TaskOwner,pos:i64,revision:i64,deleted:bool,title:&str)->Page{
  Page{contract_version:1,has_more:false,next_cursor:format!("{}.{}.{}","a".repeat(32),o.user_id.replace('-',""),pos),items:vec![Change{position:pos.to_string(),entity:"note".into(),entity_id:"b".repeat(32),revision,deleted,snapshot:json!({"id":"b".repeat(32),"revision":revision,"deletedAt":if deleted{json!("2026-11-22T00:00:00Z")}else{Value::Null},"title":title,"body":"Text","state":"active","pinned":false})}]}
 }
 #[test]
 fn inbox_atomic_cursor_restart_owner_and_comparison(){
  let t=Temp::new();let o=owner();let path=t.db();
  crate::storage::workspace::create(&path,&o,&"b".repeat(32),"note","Local","Text","active",false).unwrap();
  let first=stage(&path,&o,"",page(&o,1,1,false,"Cloud")).unwrap();assert_eq!(status(&path,&o).unwrap().cursor,first.cursor);
  let diff=compare(&path,&o,0).unwrap();assert_eq!(diff.items[0].state,"different");assert_eq!(diff.items[0].local.as_ref().unwrap()["title"],"Local");
  assert!(stage(&path,&o,"",page(&o,1,1,false,"Cloud")).is_err());
  let mut broken=page(&o,2,2,false,"Cloud");broken.next_cursor=format!("{}.{}.3","a".repeat(32),o.user_id.replace('-',""));
  assert!(stage(&path,&o,&first.cursor,broken).is_err());assert_eq!(status(&path,&o).unwrap().cursor,first.cursor);
  assert_eq!(compare(&path,&o,0).unwrap().items[0].cloud["title"],"Cloud");
  let second=stage(&path,&o,&first.cursor,page(&o,2,2,true,"Cloud")).unwrap();assert_eq!(second.records,1);
  assert_eq!(compare(&path,&o,0).unwrap().items[0].state,"cloudDeleted");
  assert_eq!(crate::storage::workspace::list(&path,&o,"note","",0).unwrap().items[0].title,"Local");
  let other=TaskOwner{user_id:"22222222-2222-4222-8222-222222222222".into(),..owner()};
  assert_eq!(status(&path,&other).unwrap().records,0);assert!(stage(&path,&other,"",page(&o,1,1,false,"Leak")).is_err());
 }
 #[test]
 fn inbox_all_domains_validation_and_budget_natural_key(){
  let t=Temp::new();let o=owner();let path=t.db();crate::storage::finance::set_budget(&path,&o,"2026-11","Food",500).unwrap();
  let payloads=vec![
   ("task",json!({"title":"Task","completed":false})),
   ("project",json!({"title":"Project","body":"","state":"active","pinned":false})),
   ("goal",json!({"title":"Goal","description":"","state":"active","targetDate":null,"progress":20})),
   ("event",json!({"title":"Event","details":"","eventDate":"2026-11-22","startTime":null,"endTime":null})),
   ("finance",json!({"title":"Entry","direction":"expense","category":"Food","amountCents":100,"entryDate":"2026-11-22","currency":"TRY"})),
   ("budget",json!({"month":"2026-11","category":"Food","limitCents":500,"currency":"TRY"}))];
  let mut current=String::new();
  for(i,(kind,mut payload))in payloads.into_iter().enumerate(){let pos=i as i64+1;let key=format!("{:032x}",pos);payload["id"]=json!(key);payload["revision"]=json!(1);payload["deletedAt"]=Value::Null;
   let mut p=page(&o,pos,1,false,"");p.items[0]=Change{position:pos.to_string(),entity:kind.into(),entity_id:key,revision:1,deleted:false,snapshot:payload};current=stage(&path,&o,&current,p).unwrap().cursor;}
  let before=compare(&path,&o,0).unwrap();
  for item in before.items{apply(&path,&o,&item.entity,&item.id,&item.local_digest,&item.cloud_digest).unwrap();}
  assert!(compare(&path,&o,0).unwrap().items.iter().all(|r|r.state=="same"));
  assert_eq!(crate::storage::outbox::count(&path,&o).unwrap(),0);
  let task_id=format!("{:032x}",1);
  let(db,_)=crate::storage::connect(&path).unwrap();assert_eq!(crate::storage::outbox::latest_revision(&db,&o,&task_id).unwrap(),Some(1));drop(db);
  crate::storage::tasks::rename(&path,&o,&task_id,"Changed after import","Task").unwrap();
  let pending=crate::storage::outbox::pending_for_task(&path,&o,&task_id).unwrap().unwrap();assert_eq!(pending.kind,"rename");assert_eq!(pending.expected_revision,1);
  let result=compare(&path,&o,0).unwrap();assert_eq!(result.total,6);assert_eq!(result.items.iter().find(|r|r.entity=="budget").unwrap().state,"same");
  let mut p=page(&o,7,1,false,"Invalid");p.items[0].snapshot["revision"]=json!(2);assert!(stage(&path,&o,&current,p).is_err());assert_eq!(status(&path,&o).unwrap().records,6);
 }
 #[test]
 fn inbox_apply_rechecks_preview_and_restores_safety_copy(){
  let t=Temp::new();let o=owner();let path=t.db();let key="b".repeat(32);
  crate::storage::workspace::create(&path,&o,&key,"note","Local","Text","active",false).unwrap();
  let first=stage(&path,&o,"",page(&o,1,1,false,"Cloud")).unwrap();let before=compare(&path,&o,0).unwrap().items.remove(0);
  crate::storage::workspace::save(&path,&o,&key,"note",1,"New local edit","Text","active",false).unwrap();
  assert!(apply(&path,&o,"note",&key,&before.local_digest,&before.cloud_digest).is_err());
  let fresh=compare(&path,&o,0).unwrap().items.remove(0);let applied=apply(&path,&o,"note",&key,&fresh.local_digest,&fresh.cloud_digest).unwrap();assert!(applied.safety_backup.is_some());
  let same=compare(&path,&o,0).unwrap().items.remove(0);assert_eq!(same.state,"same");assert!(apply(&path,&o,"note",&key,&same.local_digest,&same.cloud_digest).unwrap().safety_backup.is_none());
  stage(&path,&o,&first.cursor,page(&o,2,2,true,"Cloud")).unwrap();
  assert!(apply(&path,&o,"note",&key,&same.local_digest,&same.cloud_digest).is_err());
  let deleted=compare(&path,&o,0).unwrap().items.remove(0);
  apply(&path,&o,"note",&key,&deleted.local_digest,&deleted.cloud_digest).unwrap();assert!(crate::storage::workspace::list(&path,&o,"note","",0).unwrap().items.is_empty());
  let backup=applied.safety_backup.unwrap();let preview=crate::storage::backup::preview(&path,&o,&backup).unwrap();
  crate::storage::backup::restore(&path,&o,&backup,&preview.current_digest,&preview.backup_digest).unwrap();
  assert_eq!(crate::storage::workspace::list(&path,&o,"note","",0).unwrap().items[0].title,"New local edit");
 }

 #[test]
 fn outbound_freezes_retry_and_ack_preserves_new_local_edits(){
  let t=Temp::new();let o=owner();let path=t.db();let key="b".repeat(32);
  crate::storage::workspace::create(&path,&o,&key,"note","First","Text","active",false).unwrap();
  let item=crate::storage::outbound::list(&path,&o,0).unwrap().remove(0);
  let first=crate::storage::outbound::prepare(&path,&o,"note",&key,&item.digest,"","").unwrap();assert_eq!(first.action,"create");
  crate::storage::workspace::save(&path,&o,&key,"note",1,"Second","Text","active",false).unwrap();
  let retry=crate::storage::outbound::prepare(&path,&o,"note",&key,"stale","","").unwrap();assert_eq!(retry.operation_id,first.operation_id);assert_eq!(retry.payload["title"],"First");
  assert!(crate::storage::outbound::acknowledge(&path,&o,"note",&key,&first.operation_id,2).is_err());
  crate::storage::outbound::acknowledge(&path,&o,"note",&key,&first.operation_id,1).unwrap();
  assert_eq!(crate::storage::workspace::list(&path,&o,"note","",0).unwrap().items[0].title,"Second");
  let item=crate::storage::outbound::list(&path,&o,0).unwrap().remove(0);let next=crate::storage::outbound::prepare(&path,&o,"note",&key,&item.digest,"","").unwrap();assert_eq!(next.action,"update");assert_eq!(next.expected_revision,1);assert_eq!(next.payload["title"],"Second");
 }

 #[test]
 fn outbound_delete_requires_preview_and_preserves_recreated_local(){
  use crate::storage::{outbound,workspace};
  let t=Temp::new();let o=owner();let path=t.db();let key="c".repeat(32);
  workspace::create(&path,&o,&key,"note","Original","Text","active",false).unwrap();
  let item=outbound::list(&path,&o,0).unwrap().remove(0);
  let op=outbound::prepare(&path,&o,"note",&key,&item.digest,"","").unwrap();
  outbound::acknowledge(&path,&o,"note",&key,&op.operation_id,1).unwrap();
  assert!(outbound::removed(&path,&o,0).unwrap().is_empty());
  workspace::delete(&path,&o,&key,"note",1).unwrap();
  let removed=outbound::removed(&path,&o,0).unwrap().remove(0);
  assert!(outbound::prepare_delete(&path,&o,"note",&key,"stale").is_err());
  workspace::create(&path,&o,&key,"note","Recreated","Text","active",false).unwrap();
  assert!(outbound::prepare_delete(&path,&o,"note",&key,&removed.digest).is_err());
  workspace::delete(&path,&o,&key,"note",1).unwrap();
  let deleted=outbound::prepare_delete(&path,&o,"note",&key,&removed.digest).unwrap();
  assert_eq!(deleted.action,"delete");assert_eq!(deleted.expected_revision,1);assert_eq!(deleted.payload,json!({}));
  assert!(outbound::removed(&path,&o,0).unwrap().is_empty());
  let retry=outbound::prepare(&path,&o,"note",&key,"","","").unwrap();
  assert_eq!(retry.operation_id,deleted.operation_id);assert_eq!(retry.action,"delete");
  workspace::create(&path,&o,&key,"note","New local","Text","active",false).unwrap();
  outbound::acknowledge(&path,&o,"note",&key,&deleted.operation_id,2).unwrap();
  assert_eq!(workspace::list(&path,&o,"note","",0).unwrap().items[0].title,"New local");
  let (db,_)=crate::storage::connect(&path).unwrap();
  let binding=db.query("SELECT revision,snapshot FROM cloud_bindings", &[]).unwrap();
  assert_eq!(binding[0][0],"2");
  let snapshot:Value=serde_json::from_str(&binding[0][1]).unwrap();assert!(snapshot["deletedAt"].is_string());
  assert!(outbound::removed(&path,&o,0).unwrap().is_empty());
 }
 #[test]
 fn outbound_only_exact_rejected_requests_can_be_discarded(){
  use crate::storage::{outbound,workspace};
  let t=Temp::new();let o=owner();let path=t.db();let key="d".repeat(32);
  workspace::create(&path,&o,&key,"note","Keep me","Text","active",false).unwrap();
  let item=outbound::list(&path,&o,0).unwrap().remove(0);
  let op=outbound::prepare(&path,&o,"note",&key,&item.digest,"","").unwrap();
  assert!(outbound::discard_rejected(&path,&o,"note",&key).is_err());
  outbound::reject(&path,&o,"note",&key,&"e".repeat(32)).unwrap();
  assert!(outbound::discard_rejected(&path,&o,"note",&key).is_err());
  let mut other=owner();other.project_ref="other-project".into();
  outbound::reject(&path,&other,"note",&key,&op.operation_id).unwrap();
  assert!(outbound::discard_rejected(&path,&o,"note",&key).is_err());
  outbound::reject(&path,&o,"note",&key,&op.operation_id).unwrap();
  assert!(outbound::list(&path,&o,0).unwrap()[0].rejected);
  assert!(outbound::prepare(&path,&o,"note",&key,&item.digest,"","").is_err());
  outbound::discard_rejected(&path,&o,"note",&key).unwrap();
  assert!(!outbound::list(&path,&o,0).unwrap()[0].pending);
  assert_eq!(workspace::list(&path,&o,"note","",0).unwrap().items[0].title,"Keep me");
 }
 #[test]
 fn outbound_schema_two_migrates_frozen_operations(){
  let t=Temp::new();let path=t.db();
  {
   let db=Connection::open(&path.parent().unwrap().join("cloud-inbox.sqlite3")).unwrap();
   db.execute("PRAGMA application_id=1296389193; PRAGMA user_version=2;
    CREATE TABLE outbound(project TEXT,user_id TEXT,entity TEXT,id TEXT,operation TEXT,expected INTEGER,payload TEXT,PRIMARY KEY(project,user_id,entity,id));
    INSERT INTO outbound VALUES('p','u','note','n','op1',0,'{}'),('p','u','note','m','op2',7,'{}');").unwrap();
  }
  let db=open(&path).unwrap();assert_eq!(db.scalar("PRAGMA user_version").unwrap(),"5");
  let rows=db.query("SELECT operation,expected,payload,action,state FROM outbound ORDER BY expected",&[]).unwrap();
  assert_eq!(rows[0],vec!["op1","0","{}","create","pending"]);
  assert_eq!(rows[1],vec!["op2","7","{}","update","pending"]);
 }

 #[test]
 fn pipeline_scans_changed_records_and_durable_deletions(){
  use crate::storage::{outbound,sync,workspace};
  let t=Temp::new();let o=owner();let path=t.db();let key="b".repeat(32);
  workspace::create(&path,&o,&key,"note","First","Body","active",false).unwrap();
  sync::enable(&path,&o,true).unwrap();assert!(sync::status(&path,&o).unwrap().enabled);
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,1);
  let pending=sync::pending(&path,&o).unwrap().remove(0);
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,0);
  assert_eq!(sync::pending(&path,&o).unwrap()[0].operation_id,pending.operation_id);
  outbound::acknowledge(&path,&o,"note",&key,&pending.operation_id,1).unwrap();
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,0);
  assert!(!outbound::list(&path,&o,0).unwrap()[0].dirty);
  workspace::save(&path,&o,&key,"note",1,"Second","Body","active",false).unwrap();
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,1);
  let changed=sync::pending(&path,&o).unwrap().remove(0);assert_eq!(changed.expected_revision,1);
  outbound::acknowledge(&path,&o,"note",&key,&changed.operation_id,2).unwrap();
  workspace::delete(&path,&o,&key,"note",2).unwrap();
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,1);
  assert_eq!(sync::pending(&path,&o).unwrap()[0].action,"delete");
  let mut other=owner();other.project_ref="another-project".into();
  assert!(!sync::status(&path,&other).unwrap().enabled);assert!(sync::pending(&path,&other).unwrap().is_empty());
 }
 #[test]
 fn pipeline_task_plan_serializes_revision_and_preserves_new_edits(){
  use crate::storage::{outbound,outbox,tasks,sync};
  let t=Temp::new();let o=owner();let path=t.db();let key="c".repeat(32);
  tasks::create(&path,&o,&key,"Task").unwrap();
  tasks::set_planning(&path,&o,&key,None,Some("2026-12-01"),2).unwrap();
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,0);
  let create=outbox::pending(&path,&o,0).unwrap().remove(0);
  outbox::begin_delivery(&path,&o,create.sequence).unwrap();
  outbox::acknowledge(&path,&o,&create.operation_id,&key,1,"applied").unwrap();
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,1);
  let plan=sync::pending(&path,&o).unwrap().remove(0);
  assert_eq!(plan.entity,"taskPlan");assert_eq!(plan.expected_revision,1);
  assert_eq!(plan.payload,json!({"projectId":null,"dueDate":"2026-12-01","priority":2}));
  let remote=json!({"id":key,"title":"Cloud task","completed":false,"projectId":null,"dueDate":null,"priority":0,"revision":2,"deletedAt":null});
  stage(&path,&o,"",Page{contract_version:1,items:vec![Change{position:"1".into(),entity:"task".into(),entity_id:key.clone(),revision:2,deleted:false,snapshot:remote}],next_cursor:format!("{}.{}.1","a".repeat(32),o.user_id.replace('-', "")),has_more:false}).unwrap();
  let compared=compare(&path,&o,0).unwrap().items.remove(0);
  assert!(apply(&path,&o,"task",&key,&compared.local_digest,&compared.cloud_digest).is_err());
  assert!(tasks::rename(&path,&o,&key,"Other","Task").is_err());
  assert!(outbox::prepare_action(&path,&o,&key,"complete",Some(true)).is_err());
  tasks::set_planning(&path,&o,&key,None,Some("2026-12-02"),3).unwrap();
  outbound::acknowledge(&path,&o,"taskPlan",&key,&plan.operation_id,2).unwrap();
  let (db,_)=crate::storage::connect(&path).unwrap();assert_eq!(outbox::latest_revision(&db,&o,&key).unwrap(),Some(2));drop(db);
  assert_eq!(tasks::list(&path,&o,0).unwrap().items[0].due_date.as_deref(),Some("2026-12-02"));
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,1);
  let next=sync::pending(&path,&o).unwrap().remove(0);assert_eq!(next.expected_revision,2);
  outbound::acknowledge(&path,&o,"taskPlan",&key,&next.operation_id,3).unwrap();
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,0);
  tasks::rename(&path,&o,&key,"Renamed","Task").unwrap();
  let rename=outbox::pending(&path,&o,0).unwrap().remove(0);assert_eq!(rename.expected_revision,3);
 }
 #[test]
 fn pipeline_recovery_requires_complete_fresh_cloud_and_keeps_local_only(){
  use crate::storage::{backup,sync,workspace,tasks,outbox};
  let t=Temp::new();let o=owner();let path=t.db();let key="b".repeat(32);let local_task="c".repeat(32);
  workspace::create(&path,&o,&key,"note","Old local","Body","active",false).unwrap();
  tasks::create(&path,&o,&local_task,"Local only").unwrap();
  let saved=backup::create(&path,&o).unwrap();
  let preview=backup::preview(&path,&o,&saved.id).unwrap();
  backup::restore(&path,&o,&saved.id,&preview.current_digest,&preview.backup_digest).unwrap();
  assert!(sync::enable(&path,&o,true).is_err());assert!(sync::recovery_preview(&path,&o).is_err());
  sync::recovery_begin(&path,&o).unwrap();
  assert!(sync::status(&path,&o).unwrap().recovering);
  assert!(outbox::pending(&path,&o,0).unwrap().is_empty());
  let mut partial=page(&o,1,2,false,"Cloud");partial.has_more=true;
  let staged=stage(&path,&o,"",partial).unwrap();
  assert!(sync::recovery_preview(&path,&o).is_err());
  stage(&path,&o,&staged.cursor,Page{contract_version:1,items:vec![],next_cursor:staged.cursor.clone(),has_more:false}).unwrap();
  let preview=sync::recovery_preview(&path,&o).unwrap();assert_eq!(preview.different,1);assert_eq!(preview.local_only,1);
  assert!(sync::recovery_finish(&path,&o,&preview.digest).is_err());
  workspace::save(&path,&o,&key,"note",1,"New local","Body","active",false).unwrap();
  assert!(sync::recovery_apply(&path,&o,&preview.digest).is_err());
  let preview=sync::recovery_preview(&path,&o).unwrap();
  sync::recovery_apply(&path,&o,&preview.digest).unwrap();
  assert_eq!(workspace::list(&path,&o,"note","",0).unwrap().items[0].title,"Cloud");
  assert_eq!(tasks::list(&path,&o,0).unwrap().items[0].title,"Local only");
  let preview=sync::recovery_preview(&path,&o).unwrap();assert_eq!(preview.different,0);
  {
   let cache=open(&path).unwrap();cache.query("UPDATE sync_control SET caught_up=1 WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id]).unwrap();
  }
  assert!(sync::recovery_finish(&path,&o,&preview.digest).is_err());
  stage(&path,&o,&staged.cursor,Page{contract_version:1,items:vec![],next_cursor:staged.cursor.clone(),has_more:false}).unwrap();
  sync::recovery_finish(&path,&o,&preview.digest).unwrap();
  assert!(!sync::status(&path,&o).unwrap().paused);
  assert_eq!(outbox::pending(&path,&o,0).unwrap().len(),1);
  assert!(sync::recovery_finish(&path,&o,&preview.digest).is_err());
 }
 #[test]
 fn pipeline_restore_refuses_unresolved_workspace_request(){
  use crate::storage::{backup,outbound,workspace};
  let t=Temp::new();let o=owner();let path=t.db();let key="b".repeat(32);
  workspace::create(&path,&o,&key,"note","Note","Body","active",false).unwrap();
  let saved=backup::create(&path,&o).unwrap();let preview=backup::preview(&path,&o,&saved.id).unwrap();
  let item=outbound::list(&path,&o,0).unwrap().remove(0);
  let op=outbound::prepare(&path,&o,"note",&key,&item.digest,"","").unwrap();
  assert!(backup::restore(&path,&o,&saved.id,&preview.current_digest,&preview.backup_digest).is_err());
  assert_eq!(outbound::prepare(&path,&o,"note",&key,&item.digest,"","").unwrap().operation_id,op.operation_id);
 }

 #[test]
 fn pipeline_old_local_tasks_are_queued_once_without_guessing_cloud_revision(){
  use crate::storage::{tasks,outbox,sync};
  let t=Temp::new();let o=owner();let path=t.db();let key="f".repeat(32);
  tasks::create(&path,&o,&key,"Legacy task").unwrap();
  {let(db,_)=crate::storage::connect(&path).unwrap();db.query("DELETE FROM task_outbox WHERE task_id=?1",&[&key]).unwrap();}
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,1);
  let first=outbox::pending(&path,&o,0).unwrap().remove(0);assert_eq!(first.expected_revision,0);assert_eq!(first.kind,"create");
  assert_eq!(sync::scan(&path,&o,0).unwrap().queued,0);
  assert_eq!(outbox::pending(&path,&o,0).unwrap()[0].operation_id,first.operation_id);
 }

}

pub(super) fn digest(v:&Value)->Result<String,TaskError>{use sha2::{Digest,Sha256};Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(v).map_err(|_|bad())?)))}
fn valid_day(s:&str)->bool{
 let b=s.as_bytes();if b.len()!=10||s.starts_with("0000")||!b.iter().enumerate().all(|(i,c)|if i==4||i==7{*c==b'-'}else{c.is_ascii_digit()}){return false}
 let y=s[..4].parse::<u32>().unwrap_or(0);let m=s[5..7].parse::<u32>().unwrap_or(0);let d=s[8..].parse::<u32>().unwrap_or(0);
 let max=match m{1|3|5|7|8|10|12=>31,4|6|9|11=>30,2 if y%4==0&&(y%100!=0||y%400==0)=>29,2=>28,_=>0};d>0&&d<=max
}
fn valid_clock(s:&str)->bool{let b=s.as_bytes();b.len()==5&&b[2]==b':'&&[0,1,3,4].iter().all(|&i|b[i].is_ascii_digit())&&s[..2].parse::<u8>().is_ok_and(|h|h<24)&&s[3..].parse::<u8>().is_ok_and(|m|m<60)}
pub(super) fn import_valid(kind:&str,p:&Value)->bool{
 for &field in fields(kind).unwrap_or(&[]){if let Some(s)=p[field].as_str(){let multi=matches!(field,"body"|"description"|"details");let max=match field{"body"=>20000,"description"=>10000,"details"=>5000,"category"=>60,_=>200};if s.chars().count()>max||s.chars().any(|c|c.is_control()&&!(multi&&matches!(c,'\n'|'\r'|'\t'))){return false}if matches!(field,"title"|"category")&&(s.is_empty()||s.trim()!=s){return false}if matches!(field,"dueDate"|"targetDate"|"eventDate"|"entryDate")&&!valid_day(s){return false}}}
 match kind{
 "note"=>p["state"]=="active", "project"=>matches!(p["state"].as_str(),Some("active"|"paused"|"done"))&&p["pinned"]==false,
 "goal"=>matches!(p["state"].as_str(),Some("active"|"paused"|"done")),
 "event"=>{let a=p["startTime"].as_str();let b=p["endTime"].as_str();a.is_none_or(valid_clock)&&b.is_none_or(|end|valid_clock(end)&&a.is_some_and(|start|end>start))},
 "finance"=>p["currency"]=="TRY"&&matches!(p["direction"].as_str(),Some("income"|"expense")),
 "budget"=>p["currency"]=="TRY"&&p["month"].as_str().is_some_and(|m|m.len()==7&&valid_day(&format!("{m}-01"))),"task"=>true,_=>false}
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Applied {pub safety_backup:Option<String>}
pub fn apply(path:&Path,o:&TaskOwner,kind:&str,key:&str,local_digest:&str,cloud_digest:&str)->Result<Applied,TaskError>{
 o.validate()?;let cache=open(path)?;let cache_tx=Transaction::begin(&cache)?;let(db,_)=super::connect(path)?;let tx=Transaction::begin(&db)?;
 let result=apply_record(path,&db,&cache,o,kind,key,local_digest,cloud_digest,true)?;
 tx.commit()?;cache_tx.commit()?;Ok(result)
}
pub(super) fn apply_record(path:&Path,db:&Connection,cache:&Connection,o:&TaskOwner,kind:&str,key:&str,local_digest:&str,cloud_digest:&str,take_backup:bool)->Result<Applied,TaskError>{
 fields(kind)?;if id(key).as_deref()!=Some(key){return Err(bad())}
 let rows=cache.query("SELECT revision,deleted,snapshot FROM inbox_records WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,kind,key])?;
 if !cache.query("SELECT id FROM outbound WHERE project=?1 AND user_id=?2 AND (entity=?3 OR (?3='task' AND entity='taskPlan')) AND id=?4",&[&o.project_ref,&o.user_id,kind,key])?.is_empty(){return Err(TaskError::Conflict)}
 let row=rows.first().ok_or(TaskError::NotFound)?;let snapshot:Value=serde_json::from_str(&row[2]).map_err(|_|bad())?;
 if digest(&snapshot)?!=cloud_digest{return Err(TaskError::Conflict)}let cloud=canonical(kind,&snapshot)?;if !import_valid(kind,&cloud){return Err(bad())}
 let revision:i64=row[0].parse().map_err(|_|bad())?;let deleted=row[1]=="1";
 let current=local(&db,o,kind,key,&cloud)?;
 if digest(&json!(current))?!=local_digest{return Err(TaskError::Conflict)}
 if kind=="task"{
  if !db.query("SELECT 1 FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state<>'acknowledged' UNION ALL SELECT 1 FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state<>'acknowledged'",&[&o.project_ref,&o.user_id,key])?.is_empty(){return Err(TaskError::Conflict)}
  if super::outbox::latest_revision(&db,o,key)?.is_some_and(|r|r>revision){return Err(TaskError::Conflict)}
  if !deleted{if let Some(project)=cloud["projectId"].as_str(){if db.query("SELECT id FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 AND id=?3 AND kind='project'",&[&o.project_ref,&o.user_id,project])?.is_empty(){return Err(TaskError::Conflict)}}}
 }
 // Never delete a project while another local task still relies on it.
 if kind=="project"&&deleted&&!db.query("SELECT task_id FROM task_attributes WHERE project_ref=?1 AND user_id=?2 AND project_id=?3",&[&o.project_ref,&o.user_id,key])?.is_empty(){return Err(TaskError::Conflict)}
 let bindings=db.query("SELECT id,revision,snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity=?3",&[&o.project_ref,&o.user_id,kind])?;
 for binding in bindings{
  if binding[0]==key && binding[1]==revision.to_string() && binding[2]==row[2] && (if deleted{current.is_none()}else{current.as_ref()==Some(&cloud)}){return Ok(Applied{safety_backup:None})}
  if binding[0]==key&&binding[1].parse::<i64>().map_err(|_|bad())?>revision{return Err(TaskError::Conflict)}
  if kind=="budget"&&binding[0]!=key{let other:Value=serde_json::from_str(&binding[2]).map_err(|_|bad())?;
   if other["deletedAt"].is_null()&&other["month"]==cloud["month"]&&other["category"]==cloud["category"]{return Err(TaskError::Conflict)}}
 }
 // A safety snapshot must be written successfully before any business row changes.
 let safety=if take_backup{Some(super::backup::safety_copy(path,db,o)?.id)}else{None};
 write_local(db,o,kind,key,&cloud,deleted,current.is_some())?;
 db.query("INSERT INTO cloud_bindings VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(project_ref,user_id,entity,id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot",&[&o.project_ref,&o.user_id,kind,key,&revision.to_string(),&row[2]])?;
 cache.query("DELETE FROM sync_conflicts WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,kind,key])?;
 Ok(Applied{safety_backup:safety})
}


pub(super) fn write_local(db:&Connection,o:&TaskOwner,kind:&str,key:&str,cloud:&Value,deleted:bool,exists:bool)->Result<(),TaskError>{
 let normalized=canonical(kind,cloud)?;if !import_valid(kind,&normalized){return Err(bad())}
 if kind=="task"&&!deleted{if let Some(project)=cloud["projectId"].as_str(){if db.query("SELECT id FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 AND id=?3 AND kind='project'",&[&o.project_ref,&o.user_id,project])?.is_empty(){return Err(TaskError::Conflict)}}}
 if kind=="project"&&deleted&&!db.query("SELECT task_id FROM task_attributes WHERE project_ref=?1 AND user_id=?2 AND project_id=?3",&[&o.project_ref,&o.user_id,key])?.is_empty(){return Err(TaskError::Conflict)}
 let(table,cols)=match kind{
 "task"=>("tasks",vec!["title","completed"]),"note"|"project"=>("workspace_entries",vec!["kind","title","body","state","pinned"]),
 "goal"=>("goals",vec!["title","description","state","target_date","progress"]),"event"=>("calendar_events",vec!["title","details","event_date","start_time","end_time"]),
 "finance"=>("finance_entries",vec!["kind","title","category","amount_cents","entry_date"]),"budget"=>("finance_budgets",vec!["month","category","limit_cents"]),_=>return Err(bad())};
 let text=|field:&str|->String{match &cloud[field]{Value::Null=>String::new(),Value::Bool(b)=>if *b{"1"}else{"0"}.into(),Value::String(v)=>v.clone(),v=>v.to_string()}};
 let vals:Vec<String>=match kind{"task"=>vec![text("title"),text("completed")],"note"|"project"=>vec![kind.into(),text("title"),text("body"),text("state"),text("pinned")],"goal"=>vec![text("title"),text("description"),text("state"),text("targetDate"),text("progress")],"event"=>vec![text("title"),text("details"),text("eventDate"),text("startTime"),text("endTime")],"finance"=>vec![text("direction"),text("title"),text("category"),text("amountCents"),text("entryDate")],_=>vec![text("month"),text("category"),text("limitCents")]};
 let where_clause=if kind=="budget"{"project_ref=?1 AND user_id=?2 AND month=?3 AND category=?4"}else{"project_ref=?1 AND user_id=?2 AND id=?3"};
 let mut params=vec![o.project_ref.as_str(),o.user_id.as_str()];if kind=="budget"{params.push(&vals[0]);params.push(&vals[1]);}else{params.push(key)}
 if deleted{db.query(&format!("DELETE FROM {table} WHERE {where_clause}"),&params)?;}
 else if exists{
  let start=params.len()+1;params.extend(vals.iter().map(String::as_str));
  let changes=cols.iter().enumerate().map(|(i,c)|format!("{c}={}",if matches!(*c,"target_date"|"start_time"|"end_time"){format!("NULLIF(?{},'')",i+start)}else{format!("?{}",i+start)})).collect::<Vec<_>>().join(",");
  let meta=if matches!(kind,"note"|"project"|"goal"|"event"){",revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"}else if kind=="task"{",updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"}else{""};
  db.query(&format!("UPDATE {table} SET {changes}{meta} WHERE {where_clause}"),&params)?;
 }else{
  let mut insert_params=vec![o.project_ref.as_str(),o.user_id.as_str()];let identity=if kind=="budget"{""}else{insert_params.push(key);",id"};let start=insert_params.len()+1;insert_params.extend(vals.iter().map(String::as_str));
  let placeholders=cols.iter().enumerate().map(|(i,c)|if matches!(*c,"target_date"|"start_time"|"end_time"){format!("NULLIF(?{},'')",i+start)}else{format!("?{}",i+start)}).collect::<Vec<_>>().join(",");
  db.query(&format!("INSERT INTO {table}(project_ref,user_id{identity},{}) VALUES(?1,?2{},{placeholders})",cols.join(","),if kind=="budget"{""}else{",?3"}),&insert_params)?;
 }
 if kind=="task"&&!deleted{db.query("INSERT INTO task_attributes(task_id,project_ref,user_id,project_id,due_date,priority) VALUES(?1,?2,?3,NULLIF(?4,''),NULLIF(?5,''),?6) ON CONFLICT(task_id) DO UPDATE SET project_id=excluded.project_id,due_date=excluded.due_date,priority=excluded.priority",&[key,&o.project_ref,&o.user_id,&text("projectId"),&text("dueDate"),&text("priority")])?;}
 let after=local(&db,o,kind,key,&cloud)?;if if deleted{after.is_some()}else{after.as_ref()!=Some(cloud)}{return Err(TaskError::Conflict)}
 Ok(())
}
