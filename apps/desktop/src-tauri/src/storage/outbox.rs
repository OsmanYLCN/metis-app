//! Durable, explicitly triggered task deliveries. No background synchronization runs here.
use super::{connect, tasks::{TaskOwner, TaskError}};
use serde::Serialize;
use std::path::Path;
use super::sqlite::Transaction;

/// Durable send intent, committed BEFORE any future HTTP request. Repeat calls return
/// the same frozen command. Only open, matching snapshots are eligible.
pub fn begin_delivery(path: &Path, owner: &TaskOwner, sequence: i64) -> Result<PendingOperation, TaskError> {
    owner.validate()?;
    if sequence <= 0 { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let tx = Transaction::begin(&db)?;
    let rows = db.query("SELECT o.sequence,o.operation_id,o.task_id,o.kind,o.expected_revision,o.title FROM task_outbox o JOIN tasks t ON t.id=o.task_id AND t.project_ref=o.project_ref AND t.user_id=o.user_id WHERE o.project_ref=?1 AND o.user_id=?2 AND o.sequence=?3 AND o.state='pending' AND t.title=o.title AND t.completed=0 AND ((o.kind='create' AND o.expected_revision=0 AND NOT EXISTS(SELECT 1 FROM task_outbox older WHERE older.project_ref=o.project_ref AND older.user_id=o.user_id AND older.task_id=o.task_id AND older.state='acknowledged')) OR (o.kind='rename' AND o.expected_revision=(SELECT d.revision FROM task_outbox older JOIN outbox_delivery d ON d.sequence=older.sequence WHERE older.project_ref=o.project_ref AND older.user_id=o.user_id AND older.task_id=o.task_id AND older.state='acknowledged' ORDER BY older.sequence DESC LIMIT 1)))", &[&owner.project_ref,&owner.user_id,&sequence.to_string()])?;
    let r = rows.first().ok_or(TaskError::Conflict)?;
    let operation = PendingOperation { sequence, operation_id:r[1].clone(),task_id:r[2].clone(),kind:r[3].clone(),expected_revision:r[4].parse().map_err(|_| super::StorageError::InvalidSchema)?,title:r[5].clone() };
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
    let rows = db.query("SELECT o.sequence,o.state,o.expected_revision,COALESCE(CAST(d.revision AS TEXT),'') FROM task_outbox o JOIN outbox_delivery d ON d.sequence=o.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.operation_id=?3 AND o.task_id=?4", &[&owner.project_ref,&owner.user_id,operation_id,task_id])?;
    let r = rows.first().ok_or(TaskError::Conflict)?;
    if !matches!(r[1].as_str(),"pending"|"acknowledged") { return Err(TaskError::Conflict); }
    let expected: i64 = r[2].parse().map_err(|_| super::StorageError::InvalidSchema)?;
    if expected.checked_add(1) != Some(revision) || (r[1] == "acknowledged" && r[3] != revision.to_string())
        || (r[1] == "pending" && !r[3].is_empty() && r[3] != revision.to_string()) { return Err(TaskError::Conflict); }
    db.query("UPDATE outbox_delivery SET revision=?2 WHERE sequence=?1", &[&r[0],&revision.to_string()])?;
    db.query("UPDATE task_outbox SET state='acknowledged' WHERE sequence=?1", &[&r[0]])?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCloudStatus { pub task_id: String, pub phase: &'static str, pub revision: Option<i64> }

/// One bounded account-scoped read for the visible task page.
pub fn statuses(path: &Path, owner: &TaskOwner, task_ids: &[String]) -> Result<Vec<TaskCloudStatus>, TaskError> {
    owner.validate()?;
    if task_ids.len() > 100 || task_ids.iter().any(|id| id.len()!=32 || id.bytes().any(|b| !b.is_ascii_hexdigit() || b.is_ascii_uppercase()))
        || task_ids.iter().collect::<std::collections::HashSet<_>>().len()!=task_ids.len() { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    task_ids.iter().map(|id| {
        let rows = db.query("SELECT o.kind,o.state,COALESCE(CAST(d.revision AS TEXT),'') FROM task_outbox o LEFT JOIN outbox_delivery d ON d.sequence=o.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.task_id=?3 ORDER BY o.sequence DESC LIMIT 1", &[&owner.project_ref,&owner.user_id,id])?;
        let (phase,revision) = if let Some(row)=rows.first() {
            if row.len()!=3 { return Err(TaskError::from(super::StorageError::InvalidSchema)); }
            let phase = match (row[0].as_str(),row[1].as_str()) {
                ("create","pending") => "pendingCreate", ("rename","pending") => "pendingRename",
                (_,"acknowledged") => "sent", (_,"conflict") => "conflict",
                _ => return Err(TaskError::from(super::StorageError::InvalidSchema)),
            };
            let revision = if row[2].is_empty() { None } else { Some(row[2].parse::<i64>().map_err(|_| super::StorageError::InvalidSchema)?) };
            if (phase == "sent" && !matches!(revision, Some(value) if value > 0))
                || (phase != "sent" && revision.is_some()) { return Err(TaskError::from(super::StorageError::InvalidSchema)); }
            (phase,revision)
        } else { ("localOnly",None) };
        Ok(TaskCloudStatus { task_id:id.clone(),phase,revision })
    }).collect()
}

pub fn count(path: &Path, owner: &TaskOwner) -> Result<u32, TaskError> {
    owner.validate()?;
    let (db, _) = connect(path)?;
    let rows = db.query("SELECT count(*) FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending'", &[&owner.project_ref,&owner.user_id])?;
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
    db.query("SELECT sequence,operation_id,task_id,kind,expected_revision,title FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending' AND sequence>?3 ORDER BY sequence LIMIT 100",
        &[&owner.project_ref, &owner.user_id, &after.to_string()])?.into_iter().map(|r| {
            let invalid = || TaskError::from(super::StorageError::InvalidSchema);
            if r.len()!=6 { return Err(invalid()); }
            Ok(PendingOperation { sequence:r[0].parse().map_err(|_| invalid())?, operation_id:r[1].clone(), task_id:r[2].clone(), kind:r[3].clone(), expected_revision:r[4].parse().map_err(|_| invalid())?, title:r[5].clone() })
        }).collect()
}
