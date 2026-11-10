CREATE TABLE outbox_delivery (
    sequence INTEGER PRIMARY KEY REFERENCES task_outbox(sequence) ON DELETE RESTRICT,
    revision INTEGER CHECK(revision IS NULL OR (typeof(revision)='integer' AND revision>0)),
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- A possibly sent operation must retain its identity and payload even after a crash.
CREATE TRIGGER outbox_delivery_no_delete BEFORE DELETE ON task_outbox
WHEN EXISTS(SELECT 1 FROM outbox_delivery WHERE sequence=OLD.sequence)
BEGIN SELECT RAISE(ABORT,'delivery already started'); END;
