-- Failed logins per UTC day (YYYY-MM-DD). Only today and yesterday are kept.
CREATE TABLE login_failures (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);

-- A row here blocks every login until it is removed by hand.
CREATE TABLE login_lockout (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
