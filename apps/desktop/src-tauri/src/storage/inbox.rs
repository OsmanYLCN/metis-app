// A disposable remote mirror, never the authoritative local workspace.
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
pub struct Difference {pub entity:String,pub id:String,pub title:String,pub state:String,pub local:Option<Value>,pub cloud:Value,pub deleted:bool}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Comparison {pub items:Vec<Difference>,pub total:usize,pub has_more:bool}
fn bad()->TaskError{TaskError::InvalidInput}
fn id(s:&str)->Option<String>{if s.len()!=32 && !(s.len()==36 && s.bytes().enumerate().all(|(i,b)|if [8,13,18,23].contains(&i){b==b'-'}else{b.is_ascii_hexdigit()})){return None}let v=s.replace('-',"");(v.len()==32&&v!="0".repeat(32)&&v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))).then_some(v)}
fn cursor(s:&str,owner:&TaskOwner)->Result<(String,i64),TaskError>{
 let parts:Vec<_>=s.split('.').collect();if parts.len()!=3||parts[0].len()!=32||id(parts[0]).is_none()||parts[1]!=owner.user_id.replace('-',""){return Err(bad())}
 let pos:i64=parts[2].parse().map_err(|_|bad())?;if pos<0||pos.to_string()!=parts[2]{return Err(bad())}Ok((parts[0].into(),pos))
}
fn open(path:&Path)->Result<Connection,TaskError>{
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
 }else if version!="1"||app!="1296389193"{return Err(StorageError::InvalidSchema.into())}
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
fn canonical(kind:&str,p:&Value)->Result<Value,TaskError>{
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
 let result=state(&db,o)?;tx.commit()?;Ok(result)
}
fn local(db:&Connection,o:&TaskOwner,kind:&str,key:&str,cloud:&Value)->Result<Option<Value>,TaskError>{
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
 items.push(Difference{entity:r[0].clone(),id:r[1].clone(),title:cloud.get("title").or_else(||cloud.get("category")).and_then(Value::as_str).unwrap_or("").into(),state:state.into(),local,cloud,deleted});}
 tx.commit()?;cache_tx.commit()?;Ok(Comparison{items,total,has_more:total>offset as usize+50})
}

#[cfg(test)]
mod tests {
 use super::*;
 struct Temp(std::path::PathBuf);
 impl Temp{fn new()->Self{let p=std::env::temp_dir().join(format!("metis-inbox-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&p).unwrap();Self(p)}fn db(&self)->std::path::PathBuf{self.0.join("local.sqlite3")}}
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
  let result=compare(&path,&o,0).unwrap();assert_eq!(result.total,6);assert_eq!(result.items.iter().find(|r|r.entity=="budget").unwrap().state,"same");
  let mut p=page(&o,7,1,false,"Invalid");p.items[0].snapshot["revision"]=json!(2);assert!(stage(&path,&o,&current,p).is_err());assert_eq!(status(&path,&o).unwrap().records,6);
 }
}
