CREATE TABLE calendar_events (
 id TEXT PRIMARY KEY CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
 project_ref TEXT NOT NULL, user_id TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 details TEXT NOT NULL DEFAULT '' CHECK(length(details)<=5000),
 event_date TEXT NOT NULL CHECK(length(event_date)=10 AND event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 start_time TEXT, end_time TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(start_time IS NULL OR (length(start_time)=5 AND start_time GLOB '[0-9][0-9]:[0-9][0-9]')),
 CHECK(end_time IS NULL OR (length(end_time)=5 AND end_time GLOB '[0-9][0-9]:[0-9][0-9]'))
);
CREATE INDEX calendar_events_owner_date ON calendar_events(project_ref,user_id,event_date,start_time,id);
