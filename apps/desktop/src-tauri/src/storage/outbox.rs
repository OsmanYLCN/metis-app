//! Local preparation only. These records are not a send-ready synchronization queue.
use super::{connect, tasks::{TaskOwner, TaskError}};
use serde::Serialize;
use std::path::Path;

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
