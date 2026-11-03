-- The login lockout let anyone lock the owner out with wrong passwords, so it is gone.
-- Login is now guarded by a per-IP rate limit and a long password.
DROP TABLE login_failures;
DROP TABLE login_lockout;

-- One row per signed-in device. Only a SHA-256 hash of the token is stored,
-- so a copy of the database can't be used to sign in.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
