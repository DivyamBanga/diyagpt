CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,            -- sha256 of the bearer token; the token itself is never stored
  role TEXT NOT NULL,             -- 'user' | 'admin'
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  location TEXT,
  device TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_ip ON attempts(scope, ip, ts);
CREATE INDEX IF NOT EXISTS attempts_ts ON attempts(scope, ts);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  level TEXT NOT NULL,            -- 'info' | 'warn' | 'alert'
  message TEXT NOT NULL,
  meta TEXT,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,             -- 'chat' | 'title'
  mode TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  tools TEXT,
  ms INTEGER,
  status TEXT,
  searches INTEGER NOT NULL DEFAULT 0,
  code_runs INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_day ON usage(day);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  leaf_id TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  parent_id TEXT,
  role TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',  -- plain text, used for search
  data TEXT NOT NULL,             -- full message JSON
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,            -- Azure file id
  chat_id TEXT,
  name TEXT,
  bytes INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_chat ON files(chat_id);
