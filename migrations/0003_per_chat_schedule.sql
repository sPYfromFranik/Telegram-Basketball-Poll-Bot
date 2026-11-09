CREATE TABLE poll_schedule_v2 (
  chat_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  create_local TEXT,
  close_local TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CHECK ((enabled = 0) OR (create_local IS NOT NULL AND close_local IS NOT NULL))
);

DROP TABLE poll_schedule;
ALTER TABLE poll_schedule_v2 RENAME TO poll_schedule;
