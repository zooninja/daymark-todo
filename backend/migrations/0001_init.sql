CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE reminders (
  device_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  fire_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  sent_at INTEGER,
  PRIMARY KEY (device_id, id)
);

CREATE INDEX reminders_due_idx
  ON reminders (fire_at, last_attempt_at)
  WHERE sent_at IS NULL;
