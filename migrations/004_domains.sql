ALTER TABLE operations ADD COLUMN domain_plan TEXT;
CREATE TABLE publication_domains (
 id TEXT PRIMARY KEY,
 publication_id TEXT NOT NULL REFERENCES publications(id),
 account_id TEXT NOT NULL,
 hostname TEXT NOT NULL,
 zone_id TEXT NOT NULL,
 domain_id TEXT,
 dns_id TEXT,
 dns_owned INTEGER NOT NULL DEFAULT 0,
 dns_fingerprint TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 verified_at TEXT,
 UNIQUE(account_id,hostname)
);
CREATE UNIQUE INDEX one_active_domain_operation ON operations(
 json_extract(domain_plan,'$.account'),json_extract(domain_plan,'$.hostname')
) WHERE action IN ('domain-add','domain-remove') AND status IN ('prepared','queued','creating','protecting','uploading','deploying','verifying','removing','rolling-back','unknown');
