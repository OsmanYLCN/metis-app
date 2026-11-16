CREATE TABLE notification_state (
 project_ref TEXT NOT NULL, user_id TEXT NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('task','event','goal')),
 source_id TEXT NOT NULL CHECK(length(source_id)=32 AND source_id NOT GLOB '*[^0-9a-f]*'),
 due_date TEXT NOT NULL CHECK(length(due_date)=10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)),
 snoozed_until TEXT,
 PRIMARY KEY(project_ref,user_id,source_kind,source_id,due_date)
);
CREATE INDEX notification_state_owner ON notification_state(project_ref,user_id);
