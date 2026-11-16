CREATE TABLE finance_entries (
 id TEXT PRIMARY KEY CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
 project_ref TEXT NOT NULL, user_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 60),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 999999999999),
 entry_date TEXT NOT NULL CHECK(length(entry_date)=10 AND entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX finance_owner_date ON finance_entries(project_ref,user_id,entry_date,id);
