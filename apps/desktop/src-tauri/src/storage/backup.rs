
// Account-scoped recovery snapshots. Only native-selected paths and static SQL identifiers.
// Tokens and service credentials are deliberately outside this format.
use super::{connect,sqlite::{Connection,Transaction},tasks::{TaskOwner,TaskError},StorageError,VERSION};
use crate::session_vault::crypt_limited;
use serde::{Serialize,Deserialize};
use sha2::{Digest,Sha256};
use std::{collections::HashMap,fs::{self,OpenOptions},io::{Read,Write},path::{Path,PathBuf}};

const LIMIT:usize=64*1024*1024;
const ROW_LIMIT:usize=200_000;
struct Table {name:&'static str,columns:&'static [&'static str],nullable:&'static [usize]}
const TABLES:&[Table]=&[
 Table{name:"workspace_entries",columns:&["id","kind","title","body","state","pinned","revision","created_at","updated_at"],nullable:&[]},
 Table{name:"tasks",columns:&["id","title","completed","created_at","updated_at"],nullable:&[]},
 Table{name:"task_attributes",columns:&["task_id","project_id","due_date","priority"],nullable:&[1,2]},
 Table{name:"goals",columns:&["id","title","description","state","target_date","progress","revision","created_at","updated_at"],nullable:&[4]},
 Table{name:"finance_entries",columns:&["id","kind","title","category","amount_cents","entry_date","created_at"],nullable:&[]},
 Table{name:"calendar_events",columns:&["id","title","details","event_date","start_time","end_time","revision","created_at","updated_at"],nullable:&[4,5]},
 Table{name:"finance_budgets",columns:&["month","category","limit_cents"],nullable:&[]},
 Table{name:"notification_state",columns:&["source_kind","source_id","due_date","is_read","snoozed_until"],nullable:&[4]},
 Table{name:"task_outbox",columns:&["sequence","operation_id","task_id","kind","expected_revision","title","state","created_at"],nullable:&[]},
 Table{name:"task_action_outbox",columns:&["operation_id","task_id","kind","expected_revision","completed","state","started","revision"],nullable:&[4,7]},
];
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {format:u32,schema:u32,project:String,user:String,created_at:String,tables:Vec<Vec<Vec<String>>>,deliveries:Vec<Vec<String>>}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Count {pub name:String,pub count:usize}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct BackupInfo {pub id:String,pub created_at:String,pub counts:Vec<Count>,pub bytes:u64}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct BackupList {pub directory:String,pub items:Vec<BackupInfo>,pub unreadable:usize,pub paused:bool}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct RestorePreview {pub backup:BackupInfo,pub current_counts:Vec<Count>,pub current_digest:String,pub backup_digest:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct RestoreResult {pub safety_backup:BackupInfo,pub paused:bool}
fn err()->TaskError {StorageError::InvalidSchema.into()}
fn io_err(_:std::io::Error)->TaskError{StorageError::Unavailable.into()}
fn valid_id(s:&str)->bool{s.len()==32&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
fn context(owner:&TaskOwner)->String{format!("metis.account.backup.v1:{}:{}",owner.project_ref,owner.user_id)}
fn directory(path:&Path,owner:&TaskOwner)->Result<PathBuf,TaskError>{
 owner.validate()?;
 Ok(path.parent().ok_or(StorageError::Unavailable)?.join("backups").join(format!("{:x}",Sha256::digest(context(owner)))))
}
fn counts(s:&Snapshot)->Vec<Count>{TABLES.iter().zip(&s.tables).map(|(t,r)|Count{name:t.name.into(),count:r.len()}).collect()}
fn digest(s:&Snapshot)->Result<String,TaskError>{let bytes=serde_json::to_vec(&(&s.project,&s.user,&s.tables,&s.deliveries)).map_err(|_|err())?;Ok(format!("{:x}",Sha256::digest(bytes)))}
fn collect(db:&Connection,owner:&TaskOwner)->Result<Snapshot,TaskError>{
 let mut tables=Vec::new();
 for t in TABLES {
  let projection=t.columns.iter().enumerate().map(|(i,c)|if t.nullable.contains(&i){format!("COALESCE({c},'')")}else{c.to_string()}).collect::<Vec<_>>().join(",");
  let rows=db.query(&format!("SELECT {projection} FROM {} WHERE project_ref=?1 AND user_id=?2 ORDER BY {} LIMIT {}",t.name,t.columns.join(","),ROW_LIMIT+1),&[&owner.project_ref,&owner.user_id])?;
  if rows.len()>ROW_LIMIT{return Err(TaskError::InvalidInput)}
  tables.push(rows);
 }
 let deliveries=db.query("SELECT o.operation_id,COALESCE(d.revision,''),d.started_at FROM outbox_delivery d JOIN task_outbox o ON o.sequence=d.sequence WHERE o.project_ref=?1 AND o.user_id=?2 ORDER BY o.operation_id",&[&owner.project_ref,&owner.user_id])?;
 Ok(Snapshot{format:1,schema:VERSION,project:owner.project_ref.clone(),user:owner.user_id.clone(),created_at:db.scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')")?,tables,deliveries})
}
fn validate(s:&Snapshot,owner:&TaskOwner)->Result<(),TaskError>{
 if s.format!=1||s.schema!=VERSION||s.project!=owner.project_ref||s.user!=owner.user_id||s.tables.len()!=TABLES.len()||s.deliveries.len()>ROW_LIMIT{return Err(TaskError::InvalidInput)}
 for(t,rows)in TABLES.iter().zip(&s.tables){if rows.len()>ROW_LIMIT||rows.iter().any(|r|r.len()!=t.columns.len()){return Err(TaskError::InvalidInput)}}
 if s.deliveries.iter().any(|r|r.len()!=3){return Err(TaskError::InvalidInput)}Ok(())
}
fn read(path:&Path,owner:&TaskOwner,id:&str)->Result<(Snapshot,u64),TaskError>{
 if !valid_id(id){return Err(TaskError::InvalidInput)}
 let file=fs::File::open(directory(path,owner)?.join(format!("{id}.metisbackup"))).map_err(io_err)?;
 let size=file.metadata().map_err(io_err)?.len();if size==0||size>LIMIT as u64{return Err(TaskError::InvalidInput)}
 let mut bytes=Vec::new();file.take((LIMIT+1)as u64).read_to_end(&mut bytes).map_err(io_err)?;
 let plain=crypt_limited(&bytes,context(owner).as_bytes(),false,LIMIT).map_err(|_|err())?;
 let snapshot:Snapshot=serde_json::from_slice(plain.bytes()).map_err(|_|err())?;validate(&snapshot,owner)?;Ok((snapshot,size))
}
fn write(path:&Path,db:&Connection,owner:&TaskOwner,s:&Snapshot)->Result<BackupInfo,TaskError>{
 let mut bytes=serde_json::to_vec(s).map_err(|_|err())?;if bytes.len()>LIMIT/2{return Err(TaskError::InvalidInput)}
 let encrypted=crypt_limited(&bytes,context(owner).as_bytes(),true,LIMIT).map_err(|_|StorageError::Unavailable)?;
 bytes.fill(0);
 let dir=directory(path,owner)?;fs::create_dir_all(&dir).map_err(io_err)?;
 let id=db.scalar("SELECT lower(hex(randomblob(16)))")?;
 let temp=dir.join(format!("{id}.tmp"));let target=dir.join(format!("{id}.metisbackup"));
 let result=(||{let mut file=OpenOptions::new().write(true).create_new(true).open(&temp).map_err(io_err)?;file.write_all(encrypted.bytes()).map_err(io_err)?;file.sync_all().map_err(io_err)?;drop(file);fs::rename(&temp,&target).map_err(io_err)})();
 if result.is_err(){let _=fs::remove_file(&temp);}result?;
 Ok(BackupInfo{id,created_at:s.created_at.clone(),counts:counts(s),bytes:encrypted.bytes().len()as u64})
}
pub(super) fn ensure_send_allowed(db:&Connection,owner:&TaskOwner)->Result<(),TaskError>{
 if !db.query("SELECT backup_id FROM recovery_guard WHERE project_ref=?1 AND user_id=?2",&[&owner.project_ref,&owner.user_id])?.is_empty(){return Err(TaskError::RecoveryRequired)}Ok(())
}
pub fn create(path:&Path,owner:&TaskOwner)->Result<BackupInfo,TaskError>{
 owner.validate()?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;let snapshot=collect(&db,owner)?;let info=write(path,&db,owner,&snapshot)?;tx.commit()?;Ok(info)
}
pub fn list(path:&Path,owner:&TaskOwner)->Result<BackupList,TaskError>{
 owner.validate()?;let(db,_)=connect(path)?;let dir=directory(path,owner)?;let paused=match ensure_send_allowed(&db,owner){Ok(())=>false,Err(TaskError::RecoveryRequired)=>true,Err(e)=>return Err(e)};
 let mut files=Vec::new();if dir.exists(){for e in fs::read_dir(&dir).map_err(io_err)?{let e=e.map_err(io_err)?;let p=e.path();if p.extension().and_then(|e|e.to_str())==Some("metisbackup"){if let Some(id)=p.file_stem().and_then(|s|s.to_str()){if valid_id(id){files.push((e.metadata().map_err(io_err)?.modified().map_err(io_err)?,id.to_string()))}}}}}
 files.sort_by(|a,b|b.0.cmp(&a.0));let mut items=Vec::new();let mut unreadable=0;
 for(_,id)in files.into_iter().take(30){match read(path,owner,&id){Ok((s,bytes))=>items.push(BackupInfo{id,created_at:s.created_at.clone(),counts:counts(&s),bytes}),Err(_)=>unreadable+=1}}
 Ok(BackupList{directory:dir.to_string_lossy().into_owned(),items,unreadable,paused})
}
pub fn preview(path:&Path,owner:&TaskOwner,id:&str)->Result<RestorePreview,TaskError>{
 owner.validate()?;let(s,bytes)=read(path,owner,id)?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;let current=collect(&db,owner)?;
 let result=RestorePreview{backup:BackupInfo{id:id.into(),created_at:s.created_at.clone(),counts:counts(&s),bytes},current_counts:counts(&current),current_digest:digest(&current)?,backup_digest:digest(&s)?};tx.commit()?;Ok(result)
}
pub fn restore(path:&Path,owner:&TaskOwner,id:&str,current_digest:&str,backup_digest:&str)->Result<RestoreResult,TaskError>{
 owner.validate()?;let(s,_)=read(path,owner,id)?;if digest(&s)?!=backup_digest{return Err(TaskError::Conflict)}
 let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;let current=collect(&db,owner)?;
 if digest(&current)?!=current_digest{return Err(TaskError::Conflict)}
 // An outstanding HTTP operation must be reconciled before replacing its local journal.
 for candidate in [&current,&s]{
  if candidate.tables[9].iter().any(|r|r[5]=="pending"&&r[6]=="1")||candidate.deliveries.iter().any(|r|r[1].is_empty()){return Err(TaskError::Conflict)}
 }
 let safety=write(path,&db,owner,&current)?;
 db.query("DELETE FROM outbox_delivery WHERE sequence IN (SELECT sequence FROM task_outbox WHERE project_ref=?1 AND user_id=?2)",&[&owner.project_ref,&owner.user_id])?;
 for t in TABLES.iter().rev(){db.query(&format!("DELETE FROM {} WHERE project_ref=?1 AND user_id=?2",t.name),&[&owner.project_ref,&owner.user_id])?;}
 let mut sequences=HashMap::new();
 for(index,t)in TABLES.iter().enumerate(){
  let skip=if t.name=="task_outbox"{1}else{0};
  let columns=&t.columns[skip..];
  let values=(skip..t.columns.len()).map(|i|if t.nullable.contains(&i){format!("NULLIF(?{},'')",i-skip+3)}else{format!("?{}",i-skip+3)}).collect::<Vec<_>>().join(",");
  let sql=format!("INSERT INTO {}(project_ref,user_id,{}) VALUES(?1,?2,{values})",t.name,columns.join(","));
  for row in &s.tables[index]{
   let mut params=vec![owner.project_ref.as_str(),owner.user_id.as_str()];params.extend(row[skip..].iter().map(String::as_str));db.query(&sql,&params)?;
   if skip==1{sequences.insert(row[1].clone(),db.scalar("SELECT last_insert_rowid()")?);}
  }
 }
 for row in &s.deliveries{let sequence=sequences.get(&row[0]).ok_or_else(err)?;db.query("INSERT INTO outbox_delivery(sequence,revision,started_at) VALUES(?1,NULLIF(?2,''),?3)",&[sequence,&row[1],&row[2]])?;}
 if !db.query("PRAGMA foreign_key_check",&[])?.is_empty(){return Err(err())}
 if !db.query("SELECT a.task_id FROM task_attributes a JOIN tasks t ON t.id=a.task_id WHERE a.project_ref<>t.project_ref OR a.user_id<>t.user_id LIMIT 1",&[])?.is_empty(){return Err(err())}
 db.query("INSERT INTO recovery_guard(project_ref,user_id,restored_at,backup_id) VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?3) ON CONFLICT(project_ref,user_id) DO UPDATE SET restored_at=excluded.restored_at,backup_id=excluded.backup_id",&[&owner.project_ref,&owner.user_id,id])?;
 tx.commit()?;Ok(RestoreResult{safety_backup:safety,paused:true})
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct DeliveryStatus {pub paused:bool,pub pending:u64,pub conflicts:u64,pub uncertain:u64}
pub fn delivery_status(path:&Path,owner:&TaskOwner)->Result<DeliveryStatus,TaskError>{
 owner.validate()?;let(db,_)=connect(path)?;let tx=Transaction::begin(&db)?;
 let paused=match ensure_send_allowed(&db,owner){Ok(())=>false,Err(TaskError::RecoveryRequired)=>true,Err(e)=>return Err(e)};
 let rows=db.query("SELECT (SELECT count(*) FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending')+(SELECT count(*) FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending'),(SELECT count(*) FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND state='conflict')+(SELECT count(*) FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND state='conflict'),(SELECT count(*) FROM outbox_delivery d JOIN task_outbox o ON o.sequence=d.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.state='pending' AND d.revision IS NULL)+(SELECT count(*) FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending' AND started=1)",&[&owner.project_ref,&owner.user_id])?;
 let row=rows.first().ok_or_else(err)?;let n=|i:usize|->Result<u64,TaskError>{row.get(i).ok_or_else(err)?.parse().map_err(|_|err())};
 let result=DeliveryStatus{paused,pending:n(0)?,conflicts:n(1)?,uncertain:n(2)?};tx.commit()?;Ok(result)
}
