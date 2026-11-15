-- Separate journal preserves v4 create/rename identities and receipts without rebuilding tables.
CREATE TABLE task_action_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    project_ref TEXT NOT NULL,
    user_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id)=32 AND operation_id NOT GLOB '*[^0-9a-f]*'),
    kind TEXT NOT NULL CHECK(kind IN ('complete','delete')),
    expected_revision INTEGER NOT NULL CHECK(expected_revision>0),
    completed INTEGER CHECK(completed IN (0,1) OR completed IS NULL),
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','acknowledged','conflict')),
    started INTEGER NOT NULL DEFAULT 0 CHECK(started IN (0,1)),
    revision INTEGER CHECK(revision IS NULL OR revision=expected_revision+1),
    CHECK((kind='complete' AND completed IS NOT NULL) OR (kind='delete' AND completed IS NULL)),
    CHECK((state='acknowledged' AND revision IS NOT NULL) OR (state<>'acknowledged' AND revision IS NULL))
);
CREATE UNIQUE INDEX task_action_one_pending ON task_action_outbox(project_ref,user_id,task_id) WHERE state='pending';
CREATE INDEX task_action_owner_task ON task_action_outbox(project_ref,user_id,task_id,sequence);
CREATE TRIGGER task_action_immutable BEFORE UPDATE OF project_ref,user_id,task_id,operation_id,kind,expected_revision,completed,sequence ON task_action_outbox
BEGIN SELECT RAISE(ABORT,'task action payload is immutable'); END;
