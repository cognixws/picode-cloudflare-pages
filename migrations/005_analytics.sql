ALTER TABLE publications ADD COLUMN analytics_tag TEXT;
ALTER TABLE operations ADD COLUMN analytics INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations ADD COLUMN progress TEXT;
DROP INDEX one_active_operation;
CREATE UNIQUE INDEX one_active_operation ON operations(publication_id)
 WHERE status IN ('prepared','queued','creating','protecting','analytics','uploading','deploying','verifying','removing','rolling-back','unknown');
