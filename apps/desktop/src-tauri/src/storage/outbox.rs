//! Local preparation only. These records are not a send-ready synchronization queue.
use super::{connect, tasks::{TaskOwner, TaskError}};
use serde::Serialize;
use std::path::Path;
use super::sqlite::Transaction;

/// Durable send intent, committed BEFORE any future HTTP request. Repeat calls return
/// the same frozen command. Only open, matching create snapshots are eligible.
pub fn begin_delivery(path: &Path, owner: &TaskOwner, sequence: i64) -> Result<PendingOperation, TaskError> {
    owner.validate()?;
    if sequence <= 0 { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let tx = Transaction::begin(&db)?;
    let rows = db.query("SELECT o.sequence,o.operation_id,o.task_id,o.kind,o.expected_revision,o.title FROM task_outbox o JOIN tasks t ON t.id=o.task_id AND t.project_ref=o.project_ref AND t.user_id=o.user_id WHERE o.project_ref=?1 AND o.user_id=?2 AND o.sequence=?3 AND o.state='pending' AND o.kind='create' AND o.expected_revision=0 AND t.title=o.title AND t.completed=0", &[&owner.project_ref,&owner.user_id,&sequence.to_string()])?;
    let r = rows.first().ok_or(TaskError::Conflict)?;
    let operation = PendingOperation { sequence, operation_id:r[1].clone(),task_id:r[2].clone(),kind:r[3].clone(),expected_revision:0,title:r[5].clone() };
    db.query("INSERT INTO outbox_delivery(sequence) VALUES(?1) ON CONFLICT(sequence) DO NOTHING", &[&sequence.to_string()])?;
    tx.commit()?;
    Ok(operation)
}

/// Called only after the future authenticated HTTP client validates its response.
/// A receipt cannot acknowledge a different task, operation, owner or revision.
pub fn acknowledge(path: &Path, owner: &TaskOwner, operation_id: &str, task_id: &str, revision: i64, outcome: &str) -> Result<(), TaskError> {
    owner.validate()?;
    if revision != 1 || !matches!(outcome,"applied"|"replayed") { return Err(TaskError::InvalidInput); }
    let (db, _) = connect(path)?;
    let tx = Transaction::begin(&db)?;
    let rows = db.query("SELECT o.sequence,o.state FROM task_outbox o JOIN outbox_delivery d ON d.sequence=o.sequence WHERE o.project_ref=?1 AND o.user_id=?2 AND o.operation_id=?3 AND o.task_id=?4 AND o.kind='create' AND o.expected_revision=0", &[&owner.project_ref,&owner.user_id,operation_id,task_id])?;
    let r = rows.first().ok_or(TaskError::Conflict)?;
    if !matches!(r[1].as_str(),"pending"|"acknowledged") { return Err(TaskError::Conflict); }
    db.query("UPDATE outbox_delivery SET revision=?2 WHERE sequence=?1", &[&r[0],&revision.to_string()])?;
    db.query("UPDATE task_outbox SET state='acknowledged' WHERE sequence=?1", &[&r[0]])?;
    tx.commit()?;
    Ok(())
}

pub fn count(path: &Path, owner: &TaskOwner) -> Result<u32, TaskError> {
    owner.validate()?;
    let (db, _) = connect(path)?;
    let rows = db.query("SELECT count(*) FROM task_outbox WHERE project_ref=?1 AND user_id=?2 AND state='pending'", &[&owner.project_ref,&owner.user_id])?;
    rows[0][0].parse().map_err(|_| super::StorageError::InvalidSchema.into())
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
