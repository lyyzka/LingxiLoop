CREATE TABLE sigillo_sso_code (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX sigillo_sso_code_expires_at_idx ON sigillo_sso_code(expires_at);
