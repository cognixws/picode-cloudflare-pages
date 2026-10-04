ALTER TABLE publications ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'public';
ALTER TABLE publications ADD COLUMN access_emails TEXT NOT NULL DEFAULT '[]';
ALTER TABLE publications ADD COLUMN access_app TEXT;
ALTER TABLE publications ADD COLUMN access_fingerprint TEXT;
ALTER TABLE publications ADD COLUMN access_attempt TEXT;
ALTER TABLE publications ADD COLUMN access_verified_at TEXT;
ALTER TABLE operations ADD COLUMN access_config TEXT;
ALTER TABLE operations ADD COLUMN access_snapshot TEXT;
DROP INDEX one_active_operation;
CREATE UNIQUE INDEX one_active_operation ON operations(publication_id) WHERE status IN ('prepared','queued','creating','protecting','uploading','deploying','verifying','removing','rolling-back','unknown');
ALTER TABLE operations ADD COLUMN remote_phase TEXT;
UPDATE operations SET remote_phase=CASE
 WHEN status='unknown' AND action='publish' THEN CASE WHEN (SELECT identity FROM publications WHERE id=publication_id) IS NULL THEN 'creating' ELSE 'deploying' END
 WHEN status='unknown' AND action='remove' THEN 'removing'
 WHEN status='unknown' AND action='rollback' THEN 'rolling-back'
 ELSE status END;
ALTER TABLE publications ADD COLUMN access_delete_attempt INTEGER NOT NULL DEFAULT 0;
