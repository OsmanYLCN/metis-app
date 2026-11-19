CREATE TABLE recovery_guard (
 project_ref TEXT NOT NULL, user_id TEXT NOT NULL,
 restored_at TEXT NOT NULL, backup_id TEXT NOT NULL,
 PRIMARY KEY(project_ref,user_id)
);
