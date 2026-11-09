CREATE TABLE poll_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  create_local TEXT,
  close_local TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CHECK (
    (enabled = 0) OR
    (create_local IS NOT NULL AND close_local IS NOT NULL)
  )
);
