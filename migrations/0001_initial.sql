PRAGMA foreign_keys = ON;

CREATE TABLE poll_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_poll_id TEXT UNIQUE,
  message_id INTEGER,
  chat_id TEXT NOT NULL,
  event_date TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT,
  close_deadline TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('creating','open','closing','closed','create_failed')),
  creation_token TEXT,
  creation_claimed_at TEXT,
  closing_started_at TEXT,
  final_summary_queued_at TEXT,
  final_summary_sent_at TEXT
);
CREATE INDEX idx_polls_status_deadline ON poll_instances(status, close_deadline);

CREATE TABLE participants (
  telegram_user_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  private_chat_id TEXT,
  private_notifications INTEGER NOT NULL DEFAULT 0 CHECK (private_notifications IN (0,1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE processed_updates (
  update_id INTEGER PRIMARY KEY,
  update_type TEXT NOT NULL,
  processing_token TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE TABLE vote_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_instance_id INTEGER NOT NULL REFERENCES poll_instances(id),
  telegram_user_id TEXT NOT NULL REFERENCES participants(telegram_user_id),
  update_id INTEGER NOT NULL UNIQUE,
  vote TEXT NOT NULL CHECK (vote IN ('yes','no','retracted')),
  processed_at TEXT NOT NULL
);
CREATE INDEX idx_history_poll_time ON vote_history(poll_instance_id, id);

CREATE TABLE current_votes (
  poll_instance_id INTEGER NOT NULL REFERENCES poll_instances(id),
  telegram_user_id TEXT NOT NULL REFERENCES participants(telegram_user_id),
  vote TEXT NOT NULL CHECK (vote IN ('yes','no','retracted')),
  status TEXT NOT NULL CHECK (status IN ('confirmed','waiting','declined','retracted')),
  first_yes_at TEXT,
  latest_change_at TEXT NOT NULL,
  last_update_id INTEGER NOT NULL,
  queue_position INTEGER,
  PRIMARY KEY (poll_instance_id, telegram_user_id)
);
CREATE INDEX idx_current_poll_status ON current_votes(poll_instance_id, status);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_instance_id INTEGER NOT NULL REFERENCES poll_instances(id),
  telegram_user_id TEXT NOT NULL REFERENCES participants(telegram_user_id),
  applied_at TEXT NOT NULL,
  source_update_id INTEGER NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  queue_status TEXT NOT NULL DEFAULT 'pending' CHECK (queue_status IN ('pending','confirmed','waiting')),
  ended_at TEXT
);
CREATE UNIQUE INDEX idx_one_active_application
  ON applications(poll_instance_id, telegram_user_id) WHERE active = 1;
CREATE INDEX idx_active_queue ON applications(poll_instance_id, active, id);

CREATE TABLE notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  poll_instance_id INTEGER REFERENCES poll_instances(id),
  kind TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  text TEXT NOT NULL,
  parse_mode TEXT NOT NULL DEFAULT 'HTML',
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  claimed_at TEXT,
  sent_at TEXT,
  last_error TEXT
  ,fallback_chat_id TEXT
  ,fallback_text TEXT
  ,source_application_id INTEGER
  ,related_application_id INTEGER
);
CREATE INDEX idx_outbox_ready ON notification_outbox(state, available_at, id);

CREATE TABLE job_locks (
  lock_name TEXT PRIMARY KEY,
  owner_token TEXT,
  expires_at TEXT
);
INSERT INTO job_locks(lock_name) VALUES ('queue-reconcile'), ('scheduler');

CREATE TABLE scheduled_runs (
  job_key TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  outcome TEXT
);
