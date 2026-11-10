-- Dormant foundation: normal task commands do not enqueue or send operations yet.
CREATE TABLE task_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    project_ref TEXT NOT NULL CHECK(length(project_ref) BETWEEN 1 AND 63),
    user_id TEXT NOT NULL CHECK(length(user_id)=36),
    operation_id TEXT NOT NULL CHECK(length(operation_id)=32 AND operation_id NOT GLOB '*[^0-9a-f]*' AND operation_id<> '00000000000000000000000000000000'),
    task_id TEXT NOT NULL CHECK(length(task_id)=32 AND task_id NOT GLOB '*[^0-9a-f]*' AND task_id<> '00000000000000000000000000000000'),
    kind TEXT NOT NULL CHECK(kind IN ('create','rename')),
    expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND ((kind='create' AND expected_revision=0) OR (kind='rename' AND expected_revision>0))),
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200 AND title=trim(title)),
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','acknowledged','conflict')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(project_ref,user_id,operation_id)
);
CREATE INDEX task_outbox_owner_pending ON task_outbox(project_ref,user_id,state,sequence);
CREATE TRIGGER task_outbox_immutable BEFORE UPDATE OF project_ref,user_id,operation_id,task_id,kind,expected_revision,title,created_at,sequence ON task_outbox
BEGIN SELECT RAISE(ABORT,'outbox payload is immutable'); END;
