
use super::{backup,connect,inbox,outbound,sqlite::{Connection,Transaction},tasks::{TaskOwner,TaskError}};
use serde::Serialize;
use serde_json::{Value,json};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Status {pub enabled:bool,pub paused:bool,pub pending:usize,pub rejected:usize,pub recovering:bool}
fn guard(db:&Connection,o:&TaskOwner)->Result<String,TaskError>{
 Ok(db.query("SELECT backup_id||':'||restored_at FROM recovery_guard WHERE project_ref=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?.first().map(|r|r[0].clone()).unwrap_or_default())
}
pub fn status(path:&Path,o:&TaskOwner)->Result<Status,TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;
 let token=guard(&db,o)?;
 let control=cache.query("SELECT enabled,recovering FROM sync_control WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?;
 let rows=cache.query("SELECT state FROM outbound WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?;
 let result=Status{enabled:control.first().is_some_and(|r|r[0]=="1"),paused:!token.is_empty(),recovering:!token.is_empty()&&control.first().is_some_and(|r|r[1]==token),pending:rows.iter().filter(|r|r[0]=="pending").count(),rejected:rows.iter().filter(|r|r[0]=="rejected").count()};
 ct.commit()?;Ok(result)
}
pub fn enable(path:&Path,o:&TaskOwner,enabled:bool)->Result<(),TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;
 if enabled{backup::ensure_send_allowed(&db,o)?;}
 cache.query("INSERT INTO sync_control(project,user_id,enabled) VALUES(?1,?2,?3) ON CONFLICT(project,user_id) DO UPDATE SET enabled=excluded.enabled",&[&o.project_ref,&o.user_id,if enabled{"1"}else{"0"}])?;
 tx.commit()?;ct.commit()?;Ok(())
}
pub fn pending(path:&Path,o:&TaskOwner)->Result<Vec<outbound::Operation>,TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;backup::ensure_send_allowed(&db,o)?;
 let rows=cache.query("SELECT entity,id,operation,expected,payload,action,state FROM outbound WHERE project=?1 AND user_id=?2 AND state='pending' ORDER BY CASE entity WHEN 'project' THEN 0 WHEN 'taskPlan' THEN 2 ELSE 1 END,id LIMIT 100",&[&o.project_ref,&o.user_id])?;
 let result=rows.iter().map(|r|outbound::unpack(r)).collect();ct.commit()?;result
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Scan {pub next_offset:u32,pub queued:usize}
pub fn scan(path:&Path,o:&TaskOwner,offset:u32)->Result<Scan,TaskError>{
 let st=status(path,o)?;if st.paused{return Err(TaskError::RecoveryRequired)}
 let mut queued=0;
 // Pre-outbox installations may have tasks with no send history. A create with
 // expected revision zero cannot overwrite an unknown existing cloud record.
 {
  let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;backup::ensure_send_allowed(&db,o)?;
  let legacy=db.query("SELECT t.id,t.title FROM tasks t WHERE t.project_ref=?1 AND t.user_id=?2 AND NOT EXISTS(SELECT 1 FROM task_outbox q WHERE q.project_ref=t.project_ref AND q.user_id=t.user_id AND q.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_action_outbox a WHERE a.project_ref=t.project_ref AND a.user_id=t.user_id AND a.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM cloud_bindings b WHERE b.project_ref=t.project_ref AND b.user_id=t.user_id AND b.entity='task' AND b.id=t.id) ORDER BY t.id LIMIT 50",&[&o.project_ref,&o.user_id])?;
  for r in legacy{db.query("INSERT INTO task_outbox(project_ref,user_id,operation_id,task_id,kind,expected_revision,title) VALUES(?1,?2,lower(hex(randomblob(16))),?3,'create',0,?4)",&[&o.project_ref,&o.user_id,&r[0],&r[1]])?;queued+=1;}
  tx.commit()?;
 }
 let items=outbound::list_page(path,o,offset,false)?;let count=items.len();
 for i in items{if !i.dirty||i.pending{continue}
  match outbound::prepare(path,o,&i.entity,&i.id,&i.digest,&i.month,&i.category){
   Ok(_)=>queued+=1,Err(TaskError::Conflict|TaskError::NotFound)=>{},Err(e)=>return Err(e)
  }
 }
 // A bounded sweep; queued deletes disappear from this list and the next sweep continues.
 for i in outbound::removed(path,o,0)?{
  match outbound::prepare_delete(path,o,&i.entity,&i.id,&i.digest){
   Ok(_)=>queued+=1,Err(TaskError::Conflict|TaskError::NotFound)=>{},Err(e)=>return Err(e)
  }
 }
 Ok(Scan{next_offset:if count==50{offset+50}else{0},queued})
}
fn no_uncertain(db:&Connection,cache:&Connection,o:&TaskOwner)->Result<(),TaskError>{
 if !cache.query("SELECT id FROM outbound WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?.is_empty()
 || !db.query("SELECT o.task_id FROM task_outbox o JOIN outbox_delivery d ON d.sequence=o.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND d.revision IS NULL UNION ALL SELECT task_id FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending' AND started=1",&[&o.project_ref,&o.user_id])?.is_empty(){return Err(TaskError::Conflict)}Ok(())
}
fn clear_task_journal(db:&Connection,o:&TaskOwner)->Result<(),TaskError>{
 db.query("DELETE FROM outbox_delivery WHERE sequence IN (SELECT sequence FROM task_outbox WHERE project_ref=?1 AND user_id=?2)",&[&o.project_ref,&o.user_id])?;
 for table in ["task_outbox","task_action_outbox"]{db.query(&format!("DELETE FROM {table} WHERE project_ref=?1 AND user_id=?2"),&[&o.project_ref,&o.user_id])?;}Ok(())
}
pub fn recovery_begin(path:&Path,o:&TaskOwner)->Result<(),TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;
 let token=guard(&db,o)?;if token.is_empty(){return Err(TaskError::Conflict)}
 no_uncertain(&db,&cache,o)?;
 if cache.query("SELECT recovering FROM sync_control WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?.first().is_some_and(|r|r[0]==token){tx.commit()?;ct.commit()?;return Ok(())}
 backup::safety_copy(path,&db,o)?;
 clear_task_journal(&db,o)?;
 db.query("DELETE FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?;
 for table in ["inbox_records","inbox_state"]{cache.query(&format!("DELETE FROM {table} WHERE project=?1 AND user_id=?2"),&[&o.project_ref,&o.user_id])?;}
 cache.query("INSERT INTO sync_control(project,user_id,enabled,caught_up,recovering) VALUES(?1,?2,0,0,?3) ON CONFLICT(project,user_id) DO UPDATE SET enabled=0,caught_up=0,recovering=excluded.recovering",&[&o.project_ref,&o.user_id,&token])?;
 tx.commit()?;ct.commit()?;Ok(())
}
fn ready(db:&Connection,cache:&Connection,o:&TaskOwner)->Result<(),TaskError>{
 let token=guard(db,o)?;if token.is_empty(){return Err(TaskError::Conflict)}
 let rows=cache.query("SELECT recovering,caught_up FROM sync_control WHERE project=?1 AND user_id=?2 AND caught_up>0 AND caught_up>=unixepoch()-120",&[&o.project_ref,&o.user_id])?;
 if !rows.first().is_some_and(|r|r[0]==token){return Err(TaskError::Conflict)}
 no_uncertain(db,cache,o)
}
fn cloud(cache:&Connection,o:&TaskOwner)->Result<Vec<Vec<String>>,TaskError>{
 // Tombstones first; live projects precede live tasks. This handles budget key reuse.
 let rows=cache.query("SELECT entity,id,deleted,snapshot,revision FROM inbox_records WHERE project=?1 AND user_id=?2 ORDER BY deleted DESC,CASE entity WHEN 'project' THEN 0 WHEN 'task' THEN 2 ELSE 1 END,id",&[&o.project_ref,&o.user_id])?;
 let mut active_budgets=Vec::new();
 for r in &rows{if r[0]=="budget"&&r[2]=="0"{let p:Value=serde_json::from_str(&r[3]).map_err(|_|TaskError::InvalidInput)?;active_budgets.push((p["month"].clone(),p["category"].clone()));}}
 let mut result=Vec::new();
 for r in rows{if r[0]=="budget"&&r[2]=="1"{let p:Value=serde_json::from_str(&r[3]).map_err(|_|TaskError::InvalidInput)?;if active_budgets.contains(&(p["month"].clone(),p["category"].clone())){continue}}result.push(r);}
 Ok(result)
}
fn signature(db:&Connection,cache:&Connection,o:&TaskOwner)->Result<String,TaskError>{
 let local=backup::digest(&backup::collect(db,o)?)?;
 let cursor=cache.query("SELECT cursor FROM inbox_state WHERE project=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?;
 inbox::digest(&json!([local,cloud(cache,o)?,cursor,guard(db,o)?]))
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct RecoveryPreview{pub digest:String,pub cloud_records:usize,pub different:usize,pub local_only:usize}
pub fn recovery_preview(path:&Path,o:&TaskOwner)->Result<RecoveryPreview,TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;ready(&db,&cache,o)?;
 let rows=cloud(&cache,o)?;let mut different=0;let mut matched_local=0;
 for r in &rows{let p:Value=serde_json::from_str(&r[3]).map_err(|_|TaskError::InvalidInput)?;let c=inbox::canonical(&r[0],&p)?;let l=inbox::local(&db,o,&r[0],&r[1],&c)?;
 if l.is_some(){matched_local+=1;}if if r[2]=="1"{l.is_some()}else{l.as_ref()!=Some(&c)}{different+=1;}}
 let total=db.query("SELECT (SELECT count(*) FROM tasks WHERE project_ref=?1 AND user_id=?2)+(SELECT count(*) FROM workspace_entries WHERE project_ref=?1 AND user_id=?2)+(SELECT count(*) FROM goals WHERE project_ref=?1 AND user_id=?2)+(SELECT count(*) FROM calendar_events WHERE project_ref=?1 AND user_id=?2)+(SELECT count(*) FROM finance_entries WHERE project_ref=?1 AND user_id=?2)+(SELECT count(*) FROM finance_budgets WHERE project_ref=?1 AND user_id=?2)",&[&o.project_ref,&o.user_id])?[0][0].parse::<usize>().map_err(|_|TaskError::InvalidInput)?;
 let result=RecoveryPreview{digest:signature(&db,&cache,o)?,cloud_records:rows.len(),different,local_only:total.saturating_sub(matched_local)};tx.commit()?;ct.commit()?;Ok(result)
}
pub fn recovery_apply(path:&Path,o:&TaskOwner,digest:&str)->Result<(),TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;ready(&db,&cache,o)?;
 if signature(&db,&cache,o)?!=digest{return Err(TaskError::Conflict)}
 backup::safety_copy(path,&db,o)?;clear_task_journal(&db,o)?;
 for r in cloud(&cache,o)?{
  let p:Value=serde_json::from_str(&r[3]).map_err(|_|TaskError::InvalidInput)?;
  // Retain local-only tasks when their old project was deleted in the cloud.
  if r[0]=="project"&&r[2]=="1"{db.query("UPDATE task_attributes SET project_id=NULL WHERE project_ref=?1 AND user_id=?2 AND project_id=?3",&[&o.project_ref,&o.user_id,&r[1]])?;}
  // A tombstoned budget may share its natural key with a newer active budget.
  if r[0]=="budget"{db.query("DELETE FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity='budget' AND id=?3",&[&o.project_ref,&o.user_id,&r[1]])?;}
  let l=inbox::local(&db,o,&r[0],&r[1],&p)?;
  inbox::apply_record(path,&db,&cache,o,&r[0],&r[1],&inbox::digest(&json!(l))?,&inbox::digest(&p)?,false)?;
 }
 tx.commit()?;ct.commit()?;Ok(())
}
pub fn recovery_finish(path:&Path,o:&TaskOwner,digest:&str)->Result<(),TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;ready(&db,&cache,o)?;
 if signature(&db,&cache,o)?!=digest{return Err(TaskError::Conflict)}
 for r in cloud(&cache,o)?{
  let p:Value=serde_json::from_str(&r[3]).map_err(|_|TaskError::InvalidInput)?;let c=inbox::canonical(&r[0],&p)?;let l=inbox::local(&db,o,&r[0],&r[1],&c)?;
  if if r[2]=="1"{l.is_some()}else{l.as_ref()!=Some(&c)}{return Err(TaskError::Conflict)}
  db.query("INSERT INTO cloud_bindings VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(project_ref,user_id,entity,id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot",&[&o.project_ref,&o.user_id,&r[0],&r[1],&r[4],&r[3]])?;
 }
 backup::safety_copy(path,&db,o)?;clear_task_journal(&db,o)?;
 // Only tasks absent from the complete cloud mirror are new creates.
 db.query("INSERT INTO task_outbox(project_ref,user_id,operation_id,task_id,kind,expected_revision,title) SELECT t.project_ref,t.user_id,lower(hex(randomblob(16))),t.id,'create',0,t.title FROM tasks t WHERE t.project_ref=?1 AND t.user_id=?2 AND NOT EXISTS(SELECT 1 FROM cloud_bindings b WHERE b.project_ref=t.project_ref AND b.user_id=t.user_id AND b.entity='task' AND b.id=t.id)",&[&o.project_ref,&o.user_id])?;
 db.query("DELETE FROM recovery_guard WHERE project_ref=?1 AND user_id=?2",&[&o.project_ref,&o.user_id])?;
 tx.commit()?;ct.commit()?;Ok(())
}
