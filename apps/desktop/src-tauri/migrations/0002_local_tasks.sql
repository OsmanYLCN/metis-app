CREATE TABLE tasks (
    id TEXT PRIMARY KEY CHECK (length(id) = 32),
    project_ref TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX tasks_owner_created ON tasks(project_ref, user_id, created_at DESC, id DESC);
