ALTER TABLE poll_instances ADD COLUMN vote_close_deadline TEXT;
ALTER TABLE poll_instances ADD COLUMN decision_processed_at TEXT;

UPDATE poll_instances
SET vote_close_deadline = close_deadline
WHERE vote_close_deadline IS NULL;

CREATE INDEX idx_polls_status_vote_deadline
  ON poll_instances(status, vote_close_deadline);
