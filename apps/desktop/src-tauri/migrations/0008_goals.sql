CREATE TABLE goals (
  id TEXT PRIMARY KEY CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
  project_ref TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=10000),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','done')),
  target_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(target_date IS NULL OR (length(target_date)=10 AND target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
);
CREATE INDEX goals_owner_state ON goals(project_ref,user_id,state,target_date,updated_at,id);
