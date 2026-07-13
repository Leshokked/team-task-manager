-- 9 Birds team task board — D1 schema (safe to re-run)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,
  person TEXT NOT NULL,
  title TEXT NOT NULL,
  brand TEXT DEFAULT '',
  day TEXT DEFAULT 'Any',
  status TEXT DEFAULT 'todo',
  prio TEXT DEFAULT 'medium',
  carry INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0,
  updated_by TEXT DEFAULT '',
  helper TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checklist (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  label TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_week ON tasks(week);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brand TEXT DEFAULT '',
  date_start TEXT,           -- ISO date or NULL for TBD
  date_end TEXT,             -- ISO date or NULL (single-day events)
  venue TEXT DEFAULT '',
  owner TEXT DEFAULT '',     -- person key: brandon/angela/riley/jess/carlos
  status TEXT DEFAULT 'idea',-- idea | confirmed | promoted | done
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date_start);
