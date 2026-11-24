
use super::{backup,connect,inbox,outbound,sqlite::{Connection,Transaction},tasks::{TaskOwner,TaskError}};
use serde::Serialize;
use serde_json::{Value,json};
use std::path::Path;

// Related values are indivisible: never synthesize a financial transaction or time interval.
pub(super) fn combine(kind:&str,base:&Option<Value>,local:&Option<Value>,remote:&Option<Value>,known:bool)->Result<Option<Value>,String>{
 if local==remote{return Ok(local.clone())}
 if !known{return if local.is_none(){Ok(remote.clone())}else{Err("unknownBase".into())}}
 if local==base{return Ok(remote.clone())}
 if remote==base{return Ok(local.clone())}
 let (Some(b),Some(l),Some(r))=(base,local,remote)else{return Err("deleteEdit".into())};
 let groups:Vec<Vec<&str>>=match kind{
  "note"=>vec![vec!["title"],vec!["body"],vec!["pinned"],vec!["state"]],
  "project"=>vec![vec!["title"],vec!["body"],vec!["state"],vec!["pinned"]],
  "goal"=>vec![vec!["title"],vec!["description"],vec!["state","progress"],vec!["targetDate"]],
  "event"=>vec![vec!["title"],vec!["details"],vec!["eventDate","startTime","endTime"]],
  "task"=>vec![vec!["title"],vec!["completed"],vec!["projectId","dueDate","priority"]],
  _=>return Err("relatedFields".into())
 };
 let mut result=r.clone();
 for group in groups{
  let lc=group.iter().any(|k|l[*k]!=b[*k]);let rc=group.iter().any(|k|r[*k]!=b[*k]);
  if lc&&rc&&group.iter().any(|k|l[*k]!=r[*k]){return Err(group.join(","))}
  if lc{for k in group{result[k]=l[k].clone();}}
 }
 if !inbox::import_valid(kind,&result){return Err("validation".into())}
 Ok(Some(result))
}
pub fn receive(path:&Path,o:&TaskOwner,enabled:bool)->Result<(),TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;
 if enabled{backup::ensure_send_allowed(&db,o)?}
 cache.query("INSERT INTO sync_control(project,user_id,receiving) VALUES(?1,?2,?3) ON CONFLICT(project,user_id) DO UPDATE SET receiving=excluded.receiving",&[&o.project_ref,&o.user_id,if enabled{"1"}else{"0"}])?;
 tx.commit()?;ct.commit()?;Ok(())
}
pub(super) fn ensure_clear(cache:&Connection,o:&TaskOwner,kind:&str,id:&str)->Result<(),TaskError>{
 let entity=outbound::binding_kind(kind);
 if !cache.query("SELECT id FROM sync_conflicts WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?.is_empty(){return Err(TaskError::Conflict)}Ok(())
}
fn rows(cache:&Connection,o:&TaskOwner,offset:u32)->Result<Vec<Vec<String>>,TaskError>{
 Ok(cache.query("SELECT entity,id,revision,deleted,snapshot FROM inbox_records WHERE project=?1 AND user_id=?2 ORDER BY CASE WHEN entity='project' AND deleted=0 THEN 0 WHEN entity='budget' AND deleted=1 THEN 1 WHEN entity='task' THEN 2 WHEN entity='project' AND deleted=1 THEN 4 ELSE 3 END,id LIMIT 100 OFFSET ?3",&[&o.project_ref,&o.user_id,&offset.to_string()])?)
}
struct Context{actual:Option<Value>,local:Option<Value>,remote:Option<Value>,base:Option<Value>,snapshot:Value,known:bool,stale:bool,uncertain:bool,digest:String}
fn context(db:&Connection,cache:&Connection,o:&TaskOwner,r:&[String])->Result<Context,TaskError>{
 let kind=&r[0];let id=&r[1];let snapshot:Value=serde_json::from_str(&r[4]).map_err(|_|TaskError::InvalidInput)?;
 let canonical=inbox::canonical(kind,&snapshot)?;let remote=if r[3]=="1"{None}else{Some(canonical.clone())};
 let actual=inbox::local(db,o,kind,id,&canonical)?;let mut local=actual.clone();
 let bound=db.query("SELECT revision,snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,kind,id])?;
 let mut base=None;let mut stale=false;
 if let Some(b)=bound.first(){let p:Value=serde_json::from_str(&b[1]).map_err(|_|TaskError::InvalidInput)?;
  if p["deletedAt"].is_null(){base=Some(inbox::canonical(kind,&p)?);}
  stale=b[0].parse::<i64>().map_err(|_|TaskError::InvalidInput)?>=r[2].parse::<i64>().map_err(|_|TaskError::InvalidInput)?;
 }
 let outgoing=cache.query("SELECT operation,state,payload,action FROM outbound WHERE project=?1 AND user_id=?2 AND (entity=?3 OR (?3='task' AND entity='taskPlan')) AND id=?4",&[&o.project_ref,&o.user_id,kind,id])?;
 let mut uncertain=outgoing.iter().any(|v|v[1]=="pending");
 let mut task_rows=Vec::new();let mut actions=Vec::new();
 if kind=="task"{
  task_rows=db.query("SELECT q.operation_id,q.state,q.title,COALESCE(d.started_at,'') FROM task_outbox q LEFT JOIN outbox_delivery d ON d.sequence=q.sequence WHERE q.project_ref=?1 AND q.user_id=?2 AND q.task_id=?3 AND q.state<>'acknowledged' ORDER BY q.sequence",&[&o.project_ref,&o.user_id,id])?;
  actions=db.query("SELECT operation_id,state,kind,COALESCE(completed,''),started FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state<>'acknowledged' ORDER BY sequence",&[&o.project_ref,&o.user_id,id])?;
  uncertain|=task_rows.iter().any(|v|v[1]=="pending"&&!v[3].is_empty())||actions.iter().any(|v|v[1]=="pending"&&v[4]=="1");
  if let Some(a)=actions.last(){if a[2]=="delete"{local=None;}else if let Some(l)=local.as_mut(){l["completed"]=json!(a[3]=="1");}}
 }
 let digest=inbox::digest(&json!([actual,local,bound,r,outgoing,task_rows,actions]))?;
 Ok(Context{actual,local,remote,base,snapshot,known:!bound.is_empty(),stale,uncertain,digest})
}
fn clear_pending(db:&Connection,cache:&Connection,o:&TaskOwner,kind:&str,id:&str)->Result<(),TaskError>{
 cache.query("DELETE FROM outbound WHERE project=?1 AND user_id=?2 AND (entity=?3 OR (?3='task' AND entity='taskPlan')) AND id=?4 AND state='rejected'",&[&o.project_ref,&o.user_id,kind,id])?;
 if kind=="task"{
  db.query("DELETE FROM outbox_delivery WHERE sequence IN (SELECT sequence FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state<>'acknowledged')",&[&o.project_ref,&o.user_id,id])?;
  db.query("DELETE FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state<>'acknowledged'",&[&o.project_ref,&o.user_id,id])?;
  db.query("DELETE FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state<>'acknowledged'",&[&o.project_ref,&o.user_id,id])?;
 }Ok(())
}
fn enqueue_task(db:&Connection,o:&TaskOwner,id:&str,revision:&str,remote:&Option<Value>,wanted:&Option<Value>)->Result<(),TaskError>{
 let Some(r)=remote else{return Ok(())};
 match wanted{
  None=>{db.query("INSERT INTO task_action_outbox(project_ref,user_id,task_id,operation_id,kind,expected_revision,completed) VALUES(?1,?2,?3,lower(hex(randomblob(16))),'delete',?4,NULL)",&[&o.project_ref,&o.user_id,id,revision])?;}
  Some(l)if l["title"]!=r["title"]=>{db.query("INSERT INTO task_outbox(project_ref,user_id,task_id,operation_id,kind,expected_revision,title) VALUES(?1,?2,?3,lower(hex(randomblob(16))),'rename',?4,?5)",&[&o.project_ref,&o.user_id,id,revision,l["title"].as_str().ok_or(TaskError::InvalidInput)?])?;}
  Some(l)if l["completed"]!=r["completed"]=>{db.query("INSERT INTO task_action_outbox(project_ref,user_id,task_id,operation_id,kind,expected_revision,completed) VALUES(?1,?2,?3,lower(hex(randomblob(16))),'complete',?4,?5)",&[&o.project_ref,&o.user_id,id,revision,if l["completed"]==true{"1"}else{"0"}])?;}
  _=>{}
 }Ok(())
}
fn install(db:&Connection,cache:&Connection,o:&TaskOwner,r:&[String],c:&Context,wanted:&Option<Value>)->Result<(),TaskError>{
 if c.uncertain{return Err(TaskError::Conflict)}
 // Tombstones cannot be resurrected by updating the same remote ID.
 if wanted.is_some()&&c.remote.is_none(){return Err(TaskError::Conflict)}
 let kind=&r[0];let id=&r[1];
 if kind=="budget"{
  for b in db.query("SELECT id,snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity='budget' AND id<>?3",&[&o.project_ref,&o.user_id,id])?{
   let p:Value=serde_json::from_str(&b[1]).map_err(|_|TaskError::InvalidInput)?;
   if p["deletedAt"].is_null()&&p["month"]==c.snapshot["month"]&&p["category"]==c.snapshot["category"]{return Err(TaskError::Conflict)}
  }
 }
 clear_pending(db,cache,o,kind,id)?;
 // A pending task delete keeps its local row until the existing lifecycle receipt is acknowledged.
 let effective=if kind=="task"&&wanted.is_none()&&c.remote.is_some(){c.remote.clone()}else{wanted.clone()};
 if effective!=c.actual{
  let p=effective.as_ref().unwrap_or(&c.snapshot);
  inbox::write_local(db,o,kind,id,p,effective.is_none(),c.actual.is_some())?;
 }
 db.query("INSERT INTO cloud_bindings VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(project_ref,user_id,entity,id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot",&[&o.project_ref,&o.user_id,kind,id,&r[2],&r[4]])?;
 if kind=="task"{enqueue_task(db,o,id,&r[2],&c.remote,wanted)?;}
 cache.query("DELETE FROM sync_conflicts WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,kind,id])?;Ok(())
}
fn mark(cache:&Connection,o:&TaskOwner,r:&[String],reason:&str)->Result<(),TaskError>{
 cache.query("INSERT INTO sync_conflicts VALUES(?1,?2,?3,?4,?5) ON CONFLICT(project,user_id,entity,id) DO UPDATE SET reason=excluded.reason",&[&o.project_ref,&o.user_id,&r[0],&r[1],reason])?;Ok(())
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Report{pub applied:usize,pub conflicts:usize,pub deferred:usize,pub next_offset:u32}
pub fn run(path:&Path,o:&TaskOwner,offset:u32)->Result<Report,TaskError>{
 o.validate()?;if offset>20000{return Err(TaskError::InvalidInput)}
 let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;backup::ensure_send_allowed(&db,o)?;
 if cache.query("SELECT project FROM sync_control WHERE project=?1 AND user_id=?2 AND caught_up>0",&[&o.project_ref,&o.user_id])?.is_empty(){return Err(TaskError::Conflict)}
 let records=rows(&cache,o,offset)?;let mut report=Report{applied:0,conflicts:0,deferred:0,next_offset:if records.len()==100{offset+100}else{0}};let mut backed_up=false;
 for r in records{
  let c=context(&db,&cache,o,&r)?;
  if c.uncertain{report.deferred+=1;continue}
  if c.stale{
   cache.query("DELETE FROM sync_conflicts WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,&r[0],&r[1]])?;continue
  }
  let wanted=match combine(&r[0],&c.base,&c.local,&c.remote,c.known){Ok(v)=>v,Err(reason)=>{mark(&cache,o,&r,&reason)?;report.conflicts+=1;continue}};
  if !backed_up{
   let digest=backup::digest(&backup::collect(&db,o)?)?;
   let saved=cache.query("SELECT merge_backup FROM sync_control WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?;
   if !saved.first().is_some_and(|r|r[0]==digest){
    backup::safety_copy(path,&db,o)?;
    cache.query("UPDATE sync_control SET merge_backup=?3 WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id,&digest])?;
   }
   backed_up=true;
  }
  db.execute("SAVEPOINT merge_record")?;cache.execute("SAVEPOINT merge_record")?;
  match install(&db,&cache,o,&r,&c,&wanted){
   Ok(())=>{db.execute("RELEASE merge_record")?;cache.execute("RELEASE merge_record")?;report.applied+=1;}
   Err(TaskError::Conflict|TaskError::InvalidInput)=>{db.execute("ROLLBACK TO merge_record; RELEASE merge_record")?;cache.execute("ROLLBACK TO merge_record; RELEASE merge_record")?;mark(&cache,o,&r,"dependency")?;report.conflicts+=1;}
   Err(e)=>return Err(e)
  }
 }
 tx.commit()?;ct.commit()?;Ok(report)
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Conflict{pub entity:String,pub id:String,pub reason:String,pub digest:String,pub local:Option<Value>,pub cloud:Option<Value>,pub base:Option<Value>,pub can_keep_local:bool}
pub fn conflicts(path:&Path,o:&TaskOwner,offset:u32)->Result<Vec<Conflict>,TaskError>{
 o.validate()?;if offset>20000{return Err(TaskError::InvalidInput)}
 let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;
 let rows=cache.query("SELECT i.entity,i.id,i.revision,i.deleted,i.snapshot,c.reason FROM sync_conflicts c JOIN inbox_records i ON i.project=c.project AND i.user_id=c.user_id AND i.entity=c.entity AND i.id=c.id WHERE c.project=?1 AND c.user_id=?2 ORDER BY c.entity,c.id LIMIT 50 OFFSET ?3",&[&o.project_ref,&o.user_id,&offset.to_string()])?;
 let mut result=Vec::new();
 for r in rows{let c=context(&db,&cache,o,&r[..5])?;result.push(Conflict{entity:r[0].clone(),id:r[1].clone(),reason:r[5].clone(),digest:c.digest,can_keep_local:!c.uncertain&&c.remote.is_some(),local:c.local,cloud:c.remote,base:c.base});}
 tx.commit()?;ct.commit()?;Ok(result)
}
pub fn resolve(path:&Path,o:&TaskOwner,kind:&str,id:&str,digest:&str,choice:&str)->Result<(),TaskError>{
 o.validate()?;if !matches!(choice,"local"|"cloud"){return Err(TaskError::InvalidInput)}
 let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;backup::ensure_send_allowed(&db,o)?;
 let rows=cache.query("SELECT entity,id,revision,deleted,snapshot FROM inbox_records WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,kind,id])?;
 let r=rows.first().ok_or(TaskError::NotFound)?;let c=context(&db,&cache,o,r)?;
 if c.digest!=digest||c.uncertain||c.stale{return Err(TaskError::Conflict)}
 let wanted=if choice=="local"{&c.local}else{&c.remote};
 backup::safety_copy(path,&db,o)?;install(&db,&cache,o,r,&c,wanted)?;
 tx.commit()?;ct.commit()?;Ok(())
}
