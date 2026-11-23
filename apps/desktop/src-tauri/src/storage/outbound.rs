use super::{inbox,sqlite::Transaction,tasks::{TaskOwner,TaskError},connect};
use serde::{Serialize,Deserialize};use serde_json::{Value,json};use std::path::Path;
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Candidate{pub entity:String,pub id:String,pub title:String,pub digest:String,pub dirty:bool,pub pending:bool,pub rejected:bool,pub pending_action:String,pub month:String,pub category:String}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Operation{pub entity:String,pub id:String,pub operation_id:String,pub action:String,pub expected_revision:i64,pub payload:Value}
fn kind(s:&str)->bool{matches!(s,"note"|"project"|"goal"|"event"|"finance"|"budget"|"taskPlan")}
pub(super) fn unpack(r:&[String])->Result<Operation,TaskError>{let revision=r[3].parse().map_err(|_|TaskError::InvalidInput)?;Ok(Operation{entity:r[0].clone(),id:r[1].clone(),operation_id:r[2].clone(),action:r[5].clone(),expected_revision:revision,payload:serde_json::from_str(&r[4]).map_err(|_|TaskError::InvalidInput)?})}
pub fn list(path:&Path,o:&TaskOwner,offset:u32)->Result<Vec<Candidate>,TaskError>{list_page(path,o,offset,true)}
pub(super) fn list_page(path:&Path,o:&TaskOwner,offset:u32,include_pending:bool)->Result<Vec<Candidate>,TaskError>{
 o.validate()?;if offset>100000{return Err(TaskError::InvalidInput)}let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;
 let mut items=Vec::new();
 // SQL pagination across all local modules, no fixed-size source previews.
 let rows=db.query("SELECT kind,id,month,category FROM (SELECT kind,id,'' AS month,'' AS category FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 UNION ALL SELECT 'taskPlan',id,'','' FROM tasks WHERE project_ref=?1 AND user_id=?2 UNION ALL SELECT 'goal',id,'','' FROM goals WHERE project_ref=?1 AND user_id=?2 UNION ALL SELECT 'event',id,'','' FROM calendar_events WHERE project_ref=?1 AND user_id=?2 UNION ALL SELECT 'finance',id,'','' FROM finance_entries WHERE project_ref=?1 AND user_id=?2 UNION ALL SELECT 'budget','',month,category FROM finance_budgets WHERE project_ref=?1 AND user_id=?2) ORDER BY kind,id,month,category LIMIT 50 OFFSET ?3",&[&o.project_ref,&o.user_id,&offset.to_string()])?;
 let bindings=db.query("SELECT id,snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity='budget'",&[&o.project_ref,&o.user_id])?;
 for r in rows{let mut id=r[1].clone();if r[0]=="budget"{
   id=inbox::digest(&json!(["budget-v1",o.project_ref,o.user_id,r[2],r[3]]))?[..32].into();
   for b in &bindings{let s:Value=serde_json::from_str(&b[1]).map_err(|_|TaskError::InvalidInput)?;if s["deletedAt"].is_null()&&s["month"]==r[2]&&s["category"]==r[3]{id=b[0].clone();break}}
  }
  let payload=payload(&db,o,&r[0],&id,&json!({"month":r[2],"category":r[3]}))?.ok_or(TaskError::NotFound)?;
  let pending_rows=cache.query("SELECT state,action FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,&r[0],&id])?;let pending=!pending_rows.is_empty();let rejected=pending_rows.first().is_some_and(|r|r[0]=="rejected");
  let bound=db.query("SELECT snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,binding_kind(&r[0]),&id])?;
  let baseline=bound.first().map(|b|serde_json::from_str::<Value>(&b[0]).map_err(|_|TaskError::InvalidInput)).transpose()?;
  let dirty=match baseline {Some(b)=>!b["deletedAt"].is_null()||project_payload(&r[0],&b)?!=payload,None=>if r[0]=="taskPlan"{payload!=json!({"projectId":null,"dueDate":null,"priority":0})}else{true}};
  let title=if r[0]=="taskPlan"{inbox::local(&db,o,"task",&id,&json!({}))?.and_then(|p|p["title"].as_str().map(str::to_owned)).unwrap_or_default()}else{payload.get("title").or_else(||payload.get("category")).and_then(Value::as_str).unwrap_or("").into()};
  items.push(Candidate{entity:r[0].clone(),id,title,digest:inbox::digest(&payload)?,month:r[2].clone(),category:r[3].clone(),dirty,pending,rejected,pending_action:pending_rows.first().map(|r|r[1].clone()).unwrap_or_default()});
 }
 if include_pending&&offset==0{for r in cache.query("SELECT entity,id,operation,expected,payload,action,state FROM outbound WHERE project=?1 AND user_id=?2 ORDER BY entity,id LIMIT 50",&[&o.project_ref,&o.user_id])?{let op=unpack(&r)?;if !items.iter().any(|i|i.entity==op.entity&&i.id==op.id){items.push(Candidate{entity:op.entity,id:op.id,title:op.payload.get("title").or_else(||op.payload.get("category")).and_then(Value::as_str).unwrap_or("").into(),digest:inbox::digest(&op.payload)?,dirty:true,pending:true,rejected:r[6]=="rejected",pending_action:op.action,month:String::new(),category:String::new()});}}}
 tx.commit()?;ct.commit()?;Ok(items)
}
pub fn prepare(path:&Path,o:&TaskOwner,entity:&str,id:&str,expected_digest:&str,month:&str,category:&str)->Result<Operation,TaskError>{
 if entity=="taskPlan"{return prepare_plan(path,o,id,expected_digest)}
 o.validate()?;if !kind(entity)||id.len()!=32||!id.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()){return Err(TaskError::InvalidInput)}
 let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;super::backup::ensure_send_allowed(&db,o)?;
 let rows=cache.query("SELECT entity,id,operation,expected,payload,action,state FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;
 if let Some(row)=rows.first(){if row[6]=="rejected"{return Err(TaskError::Conflict)}let op=unpack(row)?;tx.commit()?;ct.commit()?;return Ok(op)}
 let payload=inbox::local(&db,o,entity,id,&json!({"month":month,"category":category}))?.ok_or(TaskError::NotFound)?;
 if inbox::digest(&payload)?!=expected_digest{return Err(TaskError::Conflict)}if !inbox::import_valid(entity,&payload){return Err(TaskError::InvalidInput)}
 let binding=db.query("SELECT revision,snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;
 let expected=if let Some(b)=binding.first(){let s:Value=serde_json::from_str(&b[1]).map_err(|_|TaskError::InvalidInput)?;if !s["deletedAt"].is_null(){return Err(TaskError::Conflict)}b[0].parse::<i64>().map_err(|_|TaskError::InvalidInput)?}else{0};
 if expected>=9007199254740991{return Err(TaskError::InvalidInput)}
 let op=cache.scalar("SELECT lower(hex(randomblob(16)))")?;let encoded=payload.to_string();
 cache.query("INSERT INTO outbound(project,user_id,entity,id,operation,expected,payload,action) VALUES(?1,?2,?3,?4,?5,?6,?7,CASE WHEN ?6='0' THEN 'create' ELSE 'update' END)",&[&o.project_ref,&o.user_id,entity,id,&op,&expected.to_string(),&encoded])?;
 tx.commit()?;ct.commit()?;Ok(Operation{entity:entity.into(),id:id.into(),operation_id:op,action:if expected==0{"create"}else{"update"}.into(),expected_revision:expected,payload})
}
pub fn acknowledge(path:&Path,o:&TaskOwner,entity:&str,id:&str,operation:&str,revision:i64)->Result<(),TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;
 let rows=cache.query("SELECT entity,id,operation,expected,payload,action,state FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;
 let op=unpack(rows.first().ok_or(TaskError::NotFound)?)?;if op.operation_id!=operation||op.expected_revision.checked_add(1)!=Some(revision){return Err(TaskError::Conflict)}
 let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;super::backup::ensure_send_allowed(&db,o)?;
 let bound_kind=binding_kind(entity);
 let old=db.query("SELECT revision FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,bound_kind,id])?;
 let current=if entity=="taskPlan"{super::outbox::latest_revision(&db,o,id)?.unwrap_or(0)}else{old.first().map(|r|r[0].parse::<i64>()).transpose().map_err(|_|TaskError::InvalidInput)?.unwrap_or(0)};
 if current!=op.expected_revision&&current!=revision{return Err(TaskError::Conflict)}
 let mut snapshot=if entity=="taskPlan"{let mut s=task_snapshot(&db,o,id)?;for k in ["projectId","dueDate","priority"]{s[k]=op.payload[k].clone();}s}else if op.action=="delete"{let r=db.query("SELECT snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;serde_json::from_str(&r.first().ok_or(TaskError::NotFound)?[0]).map_err(|_|TaskError::InvalidInput)?}else{op.payload};snapshot["id"]=json!(id);snapshot["revision"]=json!(revision);snapshot["deletedAt"]=if op.action=="delete"{json!(db.scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')")?)}else{Value::Null};
 db.query("INSERT INTO cloud_bindings VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(project_ref,user_id,entity,id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot",&[&o.project_ref,&o.user_id,bound_kind,id,&revision.to_string(),&snapshot.to_string()])?;
 // Binding first; an interrupted cache deletion replays the same operation and receipt.
 tx.commit()?;cache.query("DELETE FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;ct.commit()?;Ok(())
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Removed{pub entity:String,pub id:String,pub title:String,pub digest:String}
pub fn removed(path:&Path,o:&TaskOwner,offset:u32)->Result<Vec<Removed>,TaskError>{
 o.validate()?;if offset>100000{return Err(TaskError::InvalidInput)}let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;let mut result=Vec::new();
 let rows=db.query("SELECT entity,id,snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity<>'task' ORDER BY entity,id",&[&o.project_ref,&o.user_id])?;
 for r in rows{if !kind(&r[0])||r[0]=="taskPlan"{continue}let p:Value=serde_json::from_str(&r[2]).map_err(|_|TaskError::InvalidInput)?;
 if !p["deletedAt"].is_null()||inbox::local(&db,o,&r[0],&r[1],&p)?.is_some(){continue}
 if !cache.query("SELECT id FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,&r[0],&r[1]])?.is_empty(){continue}
 result.push(Removed{entity:r[0].clone(),id:r[1].clone(),title:p.get("title").or_else(||p.get("category")).and_then(Value::as_str).unwrap_or("").into(),digest:inbox::digest(&p)?});
 }
 tx.commit()?;ct.commit()?;Ok(result.into_iter().skip(offset as usize).take(50).collect())
}
pub fn prepare_delete(path:&Path,o:&TaskOwner,entity:&str,id:&str,digest:&str)->Result<Operation,TaskError>{
 o.validate()?;if !kind(entity)||entity=="taskPlan"{return Err(TaskError::InvalidInput)}let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;super::backup::ensure_send_allowed(&db,o)?;
 let pending=cache.query("SELECT entity,id,operation,expected,payload,action,state FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;
 if !pending.is_empty(){return Err(TaskError::Conflict)}
 let rows=db.query("SELECT revision,snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;let r=rows.first().ok_or(TaskError::NotFound)?;
 let payload:Value=serde_json::from_str(&r[1]).map_err(|_|TaskError::InvalidInput)?;
 if inbox::digest(&payload)?!=digest||!payload["deletedAt"].is_null()||inbox::local(&db,o,entity,id,&payload)?.is_some(){return Err(TaskError::Conflict)}
 let expected=r[0].parse::<i64>().map_err(|_|TaskError::InvalidInput)?;if expected>=9007199254740991{return Err(TaskError::InvalidInput)}
 let operation=cache.scalar("SELECT lower(hex(randomblob(16)))")?;
 cache.query("INSERT INTO outbound(project,user_id,entity,id,operation,expected,payload,action) VALUES(?1,?2,?3,?4,?5,?6,'{}','delete')",&[&o.project_ref,&o.user_id,entity,id,&operation,&r[0]])?;
 tx.commit()?;ct.commit()?;Ok(Operation{entity:entity.into(),id:id.into(),operation_id:operation,action:"delete".into(),expected_revision:expected,payload:json!({})})
}
// Only call after an authenticated, validated workspace_conflict response. Network failure is never rejection.
pub fn reject(path:&Path,o:&TaskOwner,entity:&str,id:&str,operation:&str)->Result<(),TaskError>{o.validate()?;let cache=inbox::open(path)?;cache.query("UPDATE outbound SET state='rejected' WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4 AND operation=?5",&[&o.project_ref,&o.user_id,entity,id,operation])?;Ok(())}
pub fn discard_rejected(path:&Path,o:&TaskOwner,entity:&str,id:&str)->Result<(),TaskError>{o.validate()?;let cache=inbox::open(path)?;let tx=Transaction::begin(&cache)?;
 let rows=cache.query("SELECT state,action FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;
 if !rows.first().is_some_and(|r|r[0]=="rejected"){return Err(TaskError::Conflict)}
 cache.query("DELETE FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;tx.commit()?;Ok(())}


// Task planning shares the task's cloud revision; it never creates a second task.
pub(super) fn binding_kind(kind:&str)->&str {if kind=="taskPlan"{"task"}else{kind}}
pub(super) fn project_payload(kind:&str,p:&Value)->Result<Value,TaskError>{
 if kind=="taskPlan"{Ok(json!({"projectId":p.get("projectId").cloned().unwrap_or(Value::Null),"dueDate":p.get("dueDate").cloned().unwrap_or(Value::Null),"priority":p.get("priority").cloned().unwrap_or(json!(0))}))}else{inbox::canonical(kind,p)}
}
fn payload(db:&super::sqlite::Connection,o:&TaskOwner,kind:&str,id:&str,hint:&Value)->Result<Option<Value>,TaskError>{
 inbox::local(db,o,binding_kind(kind),id,hint)?.map(|p|project_payload(kind,&p)).transpose()
}
pub(super) fn task_snapshot(db:&super::sqlite::Connection,o:&TaskOwner,id:&str)->Result<Value,TaskError>{
 let rows=db.query("SELECT snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity='task' AND id=?3",&[&o.project_ref,&o.user_id,id])?;
 if let Some(r)=rows.first(){return serde_json::from_str(&r[0]).map_err(|_|TaskError::InvalidInput)}
 let title=db.query("SELECT title FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='acknowledged' ORDER BY sequence DESC LIMIT 1",&[&o.project_ref,&o.user_id,id])?;
 let completed=db.query("SELECT completed FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND kind='complete' AND state='acknowledged' ORDER BY revision DESC LIMIT 1",&[&o.project_ref,&o.user_id,id])?;
 Ok(json!({"id":id,"title":title.first().map(|r|r[0].as_str()).unwrap_or(""),"completed":completed.first().is_some_and(|r|r[0]=="1"),"projectId":null,"dueDate":null,"priority":0,"deletedAt":null}))
}
fn prepare_plan(path:&Path,o:&TaskOwner,id:&str,digest:&str)->Result<Operation,TaskError>{
 o.validate()?;let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;super::backup::ensure_send_allowed(&db,o)?;
 let rows=cache.query("SELECT entity,id,operation,expected,payload,action,state FROM outbound WHERE project=?1 AND user_id=?2 AND entity='taskPlan' AND id=?3",&[&o.project_ref,&o.user_id,id])?;
 if let Some(r)=rows.first(){if r[6]=="rejected"{return Err(TaskError::Conflict)}let op=unpack(r)?;tx.commit()?;ct.commit()?;return Ok(op)}
 if !db.query("SELECT task_id FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state<>'acknowledged' UNION ALL SELECT task_id FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state<>'acknowledged'",&[&o.project_ref,&o.user_id,id])?.is_empty(){return Err(TaskError::Conflict)}
 let expected=super::outbox::latest_revision(&db,o,id)?.ok_or(TaskError::Conflict)?;
 if expected>=9007199254740991{return Err(TaskError::InvalidInput)}
 let p=payload(&db,o,"taskPlan",id,&json!({}))?.ok_or(TaskError::NotFound)?;
 if inbox::digest(&p)?!=digest{return Err(TaskError::Conflict)}
 if let Some(project)=p["projectId"].as_str(){
  let rows=db.query("SELECT snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity='project' AND id=?3",&[&o.project_ref,&o.user_id,project])?;
  let s:Value=serde_json::from_str(&rows.first().ok_or(TaskError::Conflict)?[0]).map_err(|_|TaskError::InvalidInput)?;
  if !s["deletedAt"].is_null(){return Err(TaskError::Conflict)}
 }
 let op=cache.scalar("SELECT lower(hex(randomblob(16)))")?;
 cache.query("INSERT INTO outbound(project,user_id,entity,id,operation,expected,payload,action) VALUES(?1,?2,'taskPlan',?3,?4,?5,?6,'update')",&[&o.project_ref,&o.user_id,id,&op,&expected.to_string(),&p.to_string()])?;
 tx.commit()?;ct.commit()?;Ok(Operation{entity:"taskPlan".into(),id:id.into(),operation_id:op,action:"update".into(),expected_revision:expected,payload:p})
}
pub(super) fn ensure_no_plan(cache:&super::sqlite::Connection,o:&TaskOwner,id:&str)->Result<(),TaskError>{
 if !cache.query("SELECT id FROM outbound WHERE project=?1 AND user_id=?2 AND entity='taskPlan' AND id=?3",&[&o.project_ref,&o.user_id,id])?.is_empty(){return Err(TaskError::Conflict)}Ok(())
}
