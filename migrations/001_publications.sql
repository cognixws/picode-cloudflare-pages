CREATE TABLE publications (
 id TEXT PRIMARY KEY,
 artifact_id TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL,
 account_id TEXT NOT NULL,
 project TEXT NOT NULL,
 identity TEXT,
 status TEXT NOT NULL DEFAULT 'draft',
 version INTEGER,
 digest TEXT,
 deployment TEXT,
 url TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE operations (
 id TEXT PRIMARY KEY,
 publication_id TEXT NOT NULL REFERENCES publications(id),
 action TEXT NOT NULL,
 version INTEGER,
 digest TEXT,
 deployment TEXT,
 status TEXT NOT NULL,
 confirmation TEXT NOT NULL,
 revision TEXT NOT NULL,
 snapshot TEXT,
 error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_active_operation ON operations(publication_id)
 WHERE status IN ('prepared','queued','creating','uploading','deploying','verifying','removing','rolling-back','unknown');
CREATE TABLE deployments (
 id TEXT PRIMARY KEY,
 publication_id TEXT NOT NULL REFERENCES publications(id),
 operation_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 digest TEXT NOT NULL,
 url TEXT NOT NULL,
 project TEXT NOT NULL,
 created_at TEXT NOT NULL
);
