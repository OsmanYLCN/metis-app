CREATE TABLE cloud_bindings (
 project_ref TEXT NOT NULL,user_id TEXT NOT NULL,entity TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),snapshot TEXT NOT NULL,
 PRIMARY KEY(project_ref,user_id,entity,id)
);
