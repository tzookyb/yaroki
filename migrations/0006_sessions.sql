-- One row per signed-in device. Only a SHA-256 hash of the token is stored,
-- so a copy of the database can't be used to sign in.
-- The old login_failures and login_lockout tables are now unused. They are dropped in a
-- later migration, because the code live during this migration still reads them.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
