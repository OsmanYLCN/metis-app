CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE local_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    storage_id TEXT NOT NULL CHECK (length(storage_id) = 32),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO local_metadata (id, storage_id) VALUES (1, lower(hex(randomblob(16))));
