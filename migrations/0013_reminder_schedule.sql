-- One row: the hour (Asia/Jerusalem) the daily watering reminder is sent, and the day it last was.
-- `source` says where the hour came from: the default, the median of past completions, or the AI.
CREATE TABLE reminder_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  source TEXT NOT NULL CHECK (source IN ('default', 'history', 'ai')),
  last_sent TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
