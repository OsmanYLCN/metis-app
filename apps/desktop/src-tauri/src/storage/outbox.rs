//! Durable, explicitly triggered task deliveries. No background synchronization runs here.
use super::{connect, tasks::{TaskOwner, TaskError}};
use serde::Serialize;
use std::path::Path;
use super::sqlite::{Connection, Transaction};

pub(super) fn latest_revision(db: &Connection, owner: &TaskOwner, task_id: &str) -> Result<Option<i64>, TaskError> {
    let rows = db.query("SELECT COALESCE(CAST(MAX(revision) AS TEXT),'') FROM (SELECT d.revision AS revision FROM task_outbox o JOIN outbox_delivery d ON d.sequence=o.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.task_id=?3 AND o.state='acknowledged' UNION ALL SELECT a.revision FROM task_action_outbox a WHERE a.project_ref=?1 AND a.user_id=?2 AND a.task_id=?3 AND a.state='acknowledged' UNION ALL SELECT revision FROM cloud_bindings WHERE project_ref=?1 AND user_id=?2 AND entity='task' AND id=?3)", &[&owner.project_ref,&owner.user_id,task_id])?;
    let value = &rows.first().ok_or(super::StorageError::InvalidSchema)?[0];
    if value.is_empty() { Ok(None) } else { Ok(Some(value.parse().map_err(|_| super::StorageError::InvalidSchema)?)) }
}

/// Durable send intent, committed BEFORE any future HTTP request. Repeat calls return
/// the same frozen command. Only open, matching snapshots are eligible.
pub fn begin_delivery(path: &Path, owner: &TaskOwner, sequence: i64) -> Result<PendingOperation, TaskError> {
    owner.validate()?;
    if sequence <= 0 { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let tx = Transaction::begin(&db)?;
    super::backup::ensure_send_allowed(&db,owner)?;
    let rows = db.query("SELECT o.sequence,o.operation_id,o.task_id,o.kind,o.expected_revision,o.title FROM task_outbox o JOIN tasks t ON t.id=o.task_id AND t.project_ref=o.project_ref AND t.user_id=o.user_id WHERE o.project_ref=?1 AND o.user_id=?2 AND o.sequence=?3 AND o.state='pending' AND t.title=o.title AND ((o.kind='create' AND o.expected_revision=0 AND NOT EXISTS(SELECT 1 FROM task_outbox older WHERE older.project_ref=o.project_ref AND older.user_id=o.user_id AND older.task_id=o.task_id AND older.state='acknowledged')) OR o.kind='rename') AND NOT EXISTS(SELECT 1 FROM task_action_outbox a WHERE a.project_ref=o.project_ref AND a.user_id=o.user_id AND a.task_id=o.task_id AND a.state='pending')", &[&owner.project_ref,&owner.user_id,&sequence.to_string()])?;
    let r = rows.first().ok_or(TaskError::Conflict)?;
    let operation = PendingOperation { sequence, operation_id:r[1].clone(),task_id:r[2].clone(),kind:r[3].clone(),expected_revision:r[4].parse().map_err(|_| super::StorageError::InvalidSchema)?,title:r[5].clone() };
    if operation.kind == "rename" && latest_revision(&db, owner, &operation.task_id)? != Some(operation.expected_revision) { return Err(TaskError::Conflict); }
    db.query("INSERT INTO outbox_delivery(sequence) VALUES(?1) ON CONFLICT(sequence) DO NOTHING", &[&sequence.to_string()])?;
    tx.commit()?;
    Ok(operation)
}

/// Called only after the future authenticated HTTP client validates its response.
/// A receipt cannot acknowledge a different task, operation, owner or revision.
pub fn acknowledge(path: &Path, owner: &TaskOwner, operation_id: &str, task_id: &str, revision: i64, outcome: &str) -> Result<(), TaskError> {
    owner.validate()?;
    if revision < 1 || !matches!(outcome,"applied"|"replayed") { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let tx = Transaction::begin(&db)?;
    super::backup::ensure_send_allowed(&db,owner)?;
    let rows = db.query("SELECT o.sequence,o.state,o.expected_revision,COALESCE(CAST(d.revision AS TEXT),''),o.kind FROM task_outbox o JOIN outbox_delivery d ON d.sequence=o.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.operation_id=?3 AND o.task_id=?4", &[&owner.project_ref,&owner.user_id,operation_id,task_id])?;
    let r = rows.first().ok_or(TaskError::Conflict)?;
    if !matches!(r[1].as_str(),"pending"|"acknowledged") { return Err(TaskError::Conflict); }
    let expected: i64 = r[2].parse().map_err(|_| super::StorageError::InvalidSchema)?;
    if expected.checked_add(1) != Some(revision) || (r[1] == "acknowledged" && r[3] != revision.to_string())
        || (r[1] == "pending" && !r[3].is_empty() && r[3] != revision.to_string()) { return Err(TaskError::Conflict); }
    db.query("UPDATE outbox_delivery SET revision=?2 WHERE sequence=?1", &[&r[0],&revision.to_string()])?;
    db.query("UPDATE task_outbox SET state='acknowledged' WHERE sequence=?1", &[&r[0]])?;
    if r[1] == "pending" && r[4] == "create" {
        // The cloud create starts open. If the user finished the local task before
        // delivery, queue the matching completion in this same commit.
        db.query("INSERT INTO task_action_outbox(project_ref,user_id,task_id,operation_id,kind,expected_revision,completed) SELECT t.project_ref,t.user_id,t.id,lower(hex(randomblob(16))),'complete',?4,1 FROM tasks t WHERE t.id=?1 AND t.project_ref=?2 AND t.user_id=?3 AND t.completed=1", &[task_id,&owner.project_ref,&owner.user_id,&revision.to_string()])?;
    }
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCloudStatus { pub task_id: String, pub phase: &'static str, pub revision: Option<i64> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAction { pub operation_id: String, pub task_id: String, pub kind: String, pub expected_revision: i64, pub completed: Option<bool> }

fn decode_action(row: &[String]) -> Result<PendingAction, TaskError> {
    if row.len()!=5 { return Err(super::StorageError::InvalidSchema.into()); }
    Ok(PendingAction { operation_id:row[0].clone(), task_id:row[1].clone(), kind:row[2].clone(),
        expected_revision:row[3].parse().map_err(|_| super::StorageError::InvalidSchema)?,
        completed:match row[4].as_str() { "0"=>Some(false),"1"=>Some(true),""=>None,_=>return Err(super::StorageError::InvalidSchema.into()) } })
}

pub fn prepare_action(path: &Path, owner: &TaskOwner, task_id: &str, kind: &str, completed: Option<bool>) -> Result<PendingAction, TaskError> {
    owner.validate()?;
    if task_id.len()!=32 || task_id.bytes().any(|b| !b.is_ascii_hexdigit() || b.is_ascii_uppercase())
        || !((kind=="complete" && completed.is_some()) || (kind=="delete" && completed.is_none())) { return Err(TaskError::InvalidInput); }
    let (db,_) = connect(path)?;
    let tx=Transaction::begin(&db)?;
    super::backup::ensure_send_allowed(&db,owner)?;
    let task=db.query("SELECT completed FROM tasks WHERE id=?1 AND project_ref=?2 AND user_id=?3", &[task_id,&owner.project_ref,&owner.user_id])?;
    if task.is_empty() { return Err(TaskError::NotFound); }
    let pending=db.query("SELECT operation_id,task_id,kind,expected_revision,COALESCE(CAST(completed AS TEXT),'') FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='pending'", &[&owner.project_ref,&owner.user_id,task_id])?;
    if let Some(row)=pending.first() {
        let action=decode_action(row)?;
        if action.kind==kind && action.completed==completed { tx.commit()?; return Ok(action); }
        return Err(TaskError::Conflict);
    }
    if !db.query("SELECT sequence FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='pending'", &[&owner.project_ref,&owner.user_id,task_id])?.is_empty() { return Err(TaskError::Conflict); }
    let revision=latest_revision(&db,owner,task_id)?.ok_or(TaskError::Conflict)?;
    if revision < 1 || revision==i64::MAX { return Err(TaskError::Conflict); }
    if kind=="complete" && task[0][0]==(if completed==Some(true) {"1"} else {"0"}) { return Err(TaskError::Conflict); }
    db.query("INSERT INTO task_action_outbox(project_ref,user_id,task_id,operation_id,kind,expected_revision,completed) VALUES(?1,?2,?3,lower(hex(randomblob(16))),?4,?5,NULLIF(?6,''))",
        &[&owner.project_ref,&owner.user_id,task_id,kind,&revision.to_string(),if completed==Some(true) {"1"} else if completed==Some(false) {"0"} else {""}])?;
    let rows=db.query("SELECT operation_id,task_id,kind,expected_revision,COALESCE(CAST(completed AS TEXT),'') FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='pending'", &[&owner.project_ref,&owner.user_id,task_id])?;
    let action=decode_action(rows.first().ok_or(super::StorageError::InvalidSchema)?)?;
    tx.commit()?; Ok(action)
}

pub fn begin_action(path: &Path, owner: &TaskOwner, operation_id: &str) -> Result<PendingAction, TaskError> {
    owner.validate()?;
    if operation_id.len()!=32 || operation_id.bytes().any(|b| !b.is_ascii_hexdigit() || b.is_ascii_uppercase()) { return Err(TaskError::InvalidInput); }
    let (db,_)=connect(path)?; let tx=Transaction::begin(&db)?;
    super::backup::ensure_send_allowed(&db,owner)?;
    let rows=db.query("SELECT operation_id,task_id,kind,expected_revision,COALESCE(CAST(completed AS TEXT),'') FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND operation_id=?3 AND state='pending'", &[&owner.project_ref,&owner.user_id,operation_id])?;
    let action=decode_action(rows.first().ok_or(TaskError::Conflict)?)?;
    if latest_revision(&db,owner,&action.task_id)? != Some(action.expected_revision) { return Err(TaskError::Conflict); }
    db.query("UPDATE task_action_outbox SET started=1 WHERE project_ref=?1 AND user_id=?2 AND operation_id=?3 AND state='pending'", &[&owner.project_ref,&owner.user_id,operation_id])?;
    tx.commit()?; Ok(action)
}

pub fn acknowledge_action(path: &Path, owner: &TaskOwner, operation_id: &str, task_id: &str, revision: i64) -> Result<(), TaskError> {
    owner.validate()?;
    let (db,_)=connect(path)?; let tx=Transaction::begin(&db)?;
    super::backup::ensure_send_allowed(&db,owner)?;
    let rows=db.query("SELECT kind,expected_revision,COALESCE(CAST(completed AS TEXT),''),state,started,COALESCE(CAST(revision AS TEXT),'') FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND operation_id=?3 AND task_id=?4", &[&owner.project_ref,&owner.user_id,operation_id,task_id])?;
    let row=rows.first().ok_or(TaskError::Conflict)?;
    let expected:i64=row[1].parse().map_err(|_| super::StorageError::InvalidSchema)?;
    if expected.checked_add(1)!=Some(revision) || row[4]!="1" { return Err(TaskError::Conflict); }
    if row[3]=="acknowledged" { return if row[5]==revision.to_string() { tx.commit()?; Ok(()) } else { Err(TaskError::Conflict) }; }
    if row[3]!="pending" || !row[5].is_empty() { return Err(TaskError::Conflict); }
    if db.query("SELECT id FROM tasks WHERE id=?1 AND project_ref=?2 AND user_id=?3", &[task_id,&owner.project_ref,&owner.user_id])?.is_empty() { return Err(TaskError::Conflict); }
    if row[0]=="complete" {
        db.query("UPDATE tasks SET completed=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND project_ref=?2 AND user_id=?3", &[task_id,&owner.project_ref,&owner.user_id,&row[2]])?;
    } else if row[0]=="delete" {
        db.query("DELETE FROM tasks WHERE id=?1 AND project_ref=?2 AND user_id=?3", &[task_id,&owner.project_ref,&owner.user_id])?;
    } else { return Err(super::StorageError::InvalidSchema.into()); }
    db.query("UPDATE task_action_outbox SET state='acknowledged',revision=?4 WHERE project_ref=?1 AND user_id=?2 AND operation_id=?3", &[&owner.project_ref,&owner.user_id,operation_id,&revision.to_string()])?;
    tx.commit()?; Ok(())
}

/// One bounded account-scoped read for the visible task page.
pub fn statuses(path: &Path, owner: &TaskOwner, task_ids: &[String]) -> Result<Vec<TaskCloudStatus>, TaskError> {
    owner.validate()?;
    if task_ids.len() > 100 || task_ids.iter().any(|id| id.len()!=32 || id.bytes().any(|b| !b.is_ascii_hexdigit() || b.is_ascii_uppercase()))
        || task_ids.iter().collect::<std::collections::HashSet<_>>().len()!=task_ids.len() { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    task_ids.iter().map(|id| {
        let action = db.query("SELECT kind FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='pending' LIMIT 1", &[&owner.project_ref,&owner.user_id,id])?;
        if let Some(row)=action.first() { return Ok(TaskCloudStatus { task_id:id.clone(), phase:if row[0]=="delete" { "pendingDelete" } else { "pendingComplete" }, revision:None }); }
        let rows = db.query("SELECT o.kind,o.state,COALESCE(CAST(d.revision AS TEXT),'') FROM task_outbox o LEFT JOIN outbox_delivery d ON d.sequence=o.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.task_id=?3 ORDER BY o.sequence DESC LIMIT 1", &[&owner.project_ref,&owner.user_id,id])?;
        let (phase,revision) = if let Some(row)=rows.first() {
            if row.len()!=3 { return Err(TaskError::from(super::StorageError::InvalidSchema)); }
            let phase = match (row[0].as_str(),row[1].as_str()) {
                ("create","pending") => "pendingCreate", ("rename","pending") => "pendingRename",
                (_,"acknowledged") => "sent", (_,"conflict") => "conflict",
                _ => return Err(TaskError::from(super::StorageError::InvalidSchema)),
            };
            let revision = if phase=="sent" { latest_revision(&db,owner,id)? }
                else if row[2].is_empty() { None } else { Some(row[2].parse::<i64>().map_err(|_| super::StorageError::InvalidSchema)?) };
            if (phase == "sent" && !matches!(revision, Some(value) if value > 0))
                || (phase != "sent" && revision.is_some()) { return Err(TaskError::from(super::StorageError::InvalidSchema)); }
            (phase,revision)
        } else { match latest_revision(&db,owner,id)? { Some(revision)=>("sent",Some(revision)),None=>("localOnly",None) } };
        Ok(TaskCloudStatus { task_id:id.clone(),phase,revision })
    }).collect()
}

pub fn count(path: &Path, owner: &TaskOwner) -> Result<u32, TaskError> {
    owner.validate()?;
    let (db, _) = connect(path)?;
    let rows = db.query("SELECT (SELECT count(*) FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending')+(SELECT count(*) FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending')", &[&owner.project_ref,&owner.user_id])?;
    rows[0][0].parse().map_err(|_| super::StorageError::InvalidSchema.into())
}

pub fn pending_for_task(path: &Path, owner: &TaskOwner, task_id: &str) -> Result<Option<PendingOperation>, TaskError> {
    owner.validate()?;
    if task_id.len()!=32 || !task_id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let rows = db.query("SELECT sequence,operation_id,task_id,kind,expected_revision,title FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND task_id=?3 AND state='pending' ORDER BY sequence LIMIT 2", &[&owner.project_ref,&owner.user_id,task_id])?;
    if rows.len()>1 { return Err(TaskError::Conflict); }
    rows.into_iter().next().map(|r| {
        if r.len()!=6 { return Err(TaskError::from(super::StorageError::InvalidSchema)); }
        Ok(PendingOperation { sequence:r[0].parse().map_err(|_| super::StorageError::InvalidSchema)?,operation_id:r[1].clone(),task_id:r[2].clone(),kind:r[3].clone(),expected_revision:r[4].parse().map_err(|_| super::StorageError::InvalidSchema)?,title:r[5].clone() })
    }).transpose()
}

/// Snapshot of at most 100 account-scoped lifecycle operations. Their immutable
/// operation IDs are reused after restart or an ambiguous network response.
pub fn pending_actions(path: &Path, owner: &TaskOwner) -> Result<Vec<PendingAction>, TaskError> {
    owner.validate()?;
    let (db, _) = connect(path)?;
    db.query("SELECT operation_id,task_id,kind,expected_revision,COALESCE(CAST(completed AS TEXT),'') FROM task_action_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending' ORDER BY sequence LIMIT 100", &[&owner.project_ref,&owner.user_id])?
        .iter().map(|row| decode_action(row)).collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOperation {
    pub sequence: i64,
    pub operation_id: String,
    pub task_id: String,
    pub kind: String,
    pub expected_revision: i64,
    pub title: String,
}

/// Bounded, ordered account partition. Never exposes tokens or another owner's rows.
pub fn pending(path: &Path, owner: &TaskOwner, after: i64) -> Result<Vec<PendingOperation>, TaskError> {
    owner.validate()?;
    if after < 0 { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    db.query("SELECT o.sequence,o.operation_id,o.task_id,o.kind,o.expected_revision,o.title FROM task_outbox o JOIN tasks t ON t.id=o.task_id AND t.project_ref=o.project_ref AND t.user_id=o.user_id WHERE o.project_ref=?1 AND o.user_id=?2 AND o.state='pending' AND o.sequence>?3 AND t.title=o.title ORDER BY o.sequence LIMIT 100",
        &[&owner.project_ref, &owner.user_id, &after.to_string()])?.into_iter().map(|r| {
            let invalid = || TaskError::from(super::StorageError::InvalidSchema);
            if r.len()!=6 { return Err(invalid()); }
            Ok(PendingOperation { sequence:r[0].parse().map_err(|_| invalid())?, operation_id:r[1].clone(), task_id:r[2].clone(), kind:r[3].clone(), expected_revision:r[4].parse().map_err(|_| invalid())?, title:r[5].clone() })
        }).collect()
}
