use super::{inbox,sqlite::Transaction,tasks::{TaskOwner,TaskError},connect};
use serde::{Serialize,Deserialize};use serde_json::{Value,json};use std::path::Path;
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Candidate{pub entity:String,pub id:String,pub title:String,pub digest:String,pub pending:bool,pub rejected:bool,pub pending_action:String,pub month:String,pub category:String}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Operation{pub entity:String,pub id:String,pub operation_id:String,pub action:String,pub expected_revision:i64,pub payload:Value}
fn kind(s:&str)->bool{matches!(s,"note"|"project"|"goal"|"event"|"finance"|"budget")}
fn unpack(r:&[String])->Result<Operation,TaskError>{let revision=r[3].parse().map_err(|_|TaskError::InvalidInput)?;Ok(Operation{entity:r[0].clone(),id:r[1].clone(),operation_id:r[2].clone(),action:r[5].clone(),expected_revision:revision,payload:serde_json::from_str(&r[4]).map_err(|_|TaskError::InvalidInput)?})}
pub fn list(path:&Path,o:&TaskOwner,offset:u32)->Result<Vec<Candidate>,TaskError>{
 o.validate()?;if offset>100000{return Err(TaskError::InvalidInput)}let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;
 let mut items=Vec::new();
 // SQL pagination across all local modules, no fixed-size source previews.
 let rows=db.query("SELECT kind,id,month,category FROM (SELECT kind,id,'' AS month,'' AS category FROM workspace_entries WHERE project_ref=?1 AND user_id=?2 UNION ALL SELECT 'goal',id,'','' FROM goals WHERE project_ref=?1 AND user_id=?2 UNION ALL SELECT 'event',id,'','' FROM calendar_events WHERE project_ref=?1 AND user_id=?2 UNION ALL SELECT 'finance',id,'','' FROM finance_entries WHERE project_ref=?1 AND user_id=?2 UNION ALL SELECT 'budget','',month,category FROM finance_budgets WHERE project_ref=?1 AND user_id=?2) ORDER BY kind,id,month,category LIMIT 50 OFFSET ?3",&[&o.project_ref,&o.user_id,&offset.to_string()])?;
 let bindings=db.query("SELECT id,snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity='budget'",&[&o.project_ref,&o.user_id])?;
 for r in rows{let mut id=r[1].clone();if r[0]=="budget"{
   id=inbox::digest(&json!(["budget-v1",o.project_ref,o.user_id,r[2],r[3]]))?[..32].into();
   for b in &bindings{let s:Value=serde_json::from_str(&b[1]).map_err(|_|TaskError::InvalidInput)?;if s["deletedAt"].is_null()&&s["month"]==r[2]&&s["category"]==r[3]{id=b[0].clone();break}}
  }
  let payload=inbox::local(&db,o,&r[0],&id,&json!({"month":r[2],"category":r[3]}))?.ok_or(TaskError::NotFound)?;
  let pending_rows=cache.query("SELECT state,action FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,&r[0],&id])?;let pending=!pending_rows.is_empty();let rejected=pending_rows.first().is_some_and(|r|r[0]=="rejected");
  items.push(Candidate{entity:r[0].clone(),id,title:payload.get("title").or_else(||payload.get("category")).and_then(Value::as_str).unwrap_or("").into(),digest:inbox::digest(&payload)?,month:r[2].clone(),category:r[3].clone(),pending,rejected,pending_action:pending_rows.first().map(|r|r[1].clone()).unwrap_or_default()});
 }
 if offset==0{for r in cache.query("SELECT entity,id,operation,expected,payload,action,state FROM outbound WHERE project=?1 AND user_id=?2 ORDER BY entity,id LIMIT 50",&[&o.project_ref,&o.user_id])?{let op=unpack(&r)?;if !items.iter().any(|i|i.entity==op.entity&&i.id==op.id){items.push(Candidate{entity:op.entity,id:op.id,title:op.payload.get("title").or_else(||op.payload.get("category")).and_then(Value::as_str).unwrap_or("").into(),digest:inbox::digest(&op.payload)?,pending:true,rejected:r[6]=="rejected",pending_action:op.action,month:String::new(),category:String::new()});}}}
 tx.commit()?;ct.commit()?;Ok(items)
}
pub fn prepare(path:&Path,o:&TaskOwner,entity:&str,id:&str,expected_digest:&str,month:&str,category:&str)->Result<Operation,TaskError>{
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
 let old=db.query("SELECT revision FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;
 let current=old.first().map(|r|r[0].parse::<i64>()).transpose().map_err(|_|TaskError::InvalidInput)?.unwrap_or(0);
 if current!=op.expected_revision&&current!=revision{return Err(TaskError::Conflict)}
 let mut snapshot=if op.action=="delete"{let r=db.query("SELECT snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;serde_json::from_str(&r.first().ok_or(TaskError::NotFound)?[0]).map_err(|_|TaskError::InvalidInput)?}else{op.payload};snapshot["id"]=json!(id);snapshot["revision"]=json!(revision);snapshot["deletedAt"]=if op.action=="delete"{json!(db.scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')")?)}else{Value::Null};
 db.query("INSERT INTO cloud_bindings VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(project_ref,user_id,entity,id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot",&[&o.project_ref,&o.user_id,entity,id,&revision.to_string(),&snapshot.to_string()])?;
 // Binding first; an interrupted cache deletion replays the same operation and receipt.
 tx.commit()?;cache.query("DELETE FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,entity,id])?;ct.commit()?;Ok(())
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Removed{pub entity:String,pub id:String,pub title:String,pub digest:String}
pub fn removed(path:&Path,o:&TaskOwner,offset:u32)->Result<Vec<Removed>,TaskError>{
 o.validate()?;if offset>100000{return Err(TaskError::InvalidInput)}let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;let mut result=Vec::new();
 let rows=db.query("SELECT entity,id,snapshot FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity<>'task' ORDER BY entity,id",&[&o.project_ref,&o.user_id])?;
 for r in rows{if !kind(&r[0]){continue}let p:Value=serde_json::from_str(&r[2]).map_err(|_|TaskError::InvalidInput)?;
 if !p["deletedAt"].is_null()||inbox::local(&db,o,&r[0],&r[1],&p)?.is_some(){continue}
 if !cache.query("SELECT id FROM outbound WHERE project=?1 AND user_id=?2 AND entity=?3 AND id=?4",&[&o.project_ref,&o.user_id,&r[0],&r[1]])?.is_empty(){continue}
 result.push(Removed{entity:r[0].clone(),id:r[1].clone(),title:p.get("title").or_else(||p.get("category")).and_then(Value::as_str).unwrap_or("").into(),digest:inbox::digest(&p)?});
 }
 tx.commit()?;ct.commit()?;Ok(result.into_iter().skip(offset as usize).take(50).collect())
}
pub fn prepare_delete(path:&Path,o:&TaskOwner,entity:&str,id:&str,digest:&str)->Result<Operation,TaskError>{
 o.validate()?;if !kind(entity){return Err(TaskError::InvalidInput)}let cache=inbox::open(path)?;let ct=Transaction::begin(&cache)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;super::backup::ensure_send_allowed(&db,o)?;
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
