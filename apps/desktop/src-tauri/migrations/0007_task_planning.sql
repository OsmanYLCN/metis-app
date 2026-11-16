CREATE TABLE task_attributes (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  project_ref TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  due_date TEXT,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  CHECK (due_date IS NULL OR (length(due_date) = 10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
);

CREATE INDEX task_attributes_owner_due
  ON task_attributes(project_ref, user_id, due_date, task_id);
