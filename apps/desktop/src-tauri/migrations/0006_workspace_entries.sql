CREATE TABLE workspace_entries (
    id TEXT PRIMARY KEY CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
    project_ref TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('note','project')),
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
    body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=20000),
    state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','done')),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK((kind='note' AND state='active') OR (kind='project' AND pinned=0))
);
CREATE INDEX workspace_entries_owner ON workspace_entries(project_ref,user_id,kind,pinned,updated_at,id);
