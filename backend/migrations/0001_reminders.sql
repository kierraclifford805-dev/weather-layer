PRAGMA foreign_keys = ON;
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, -- SHA-256 of a 256-bit bearer capability; never the token itself
  subscription TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE plans (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  config TEXT NOT NULL,
  local_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  next_run_at INTEGER,
  next_target_date TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX due_plans ON plans(enabled, next_run_at);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('scheduled','test')),
  dedupe_key TEXT NOT NULL,
  target_date TEXT NOT NULL,
  config TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','claimed','sending','retry','push_accepted','failed','expired','cancelled','unknown')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  last_code TEXT,
  accepted_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, revision, kind, dedupe_key)
);
CREATE INDEX due_jobs ON jobs(state, next_attempt_at, expires_at);
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL,
  code TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
