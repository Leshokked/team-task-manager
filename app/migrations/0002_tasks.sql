CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,
  person TEXT NOT NULL,
  title TEXT NOT NULL,
  brand TEXT DEFAULT '',
  day TEXT DEFAULT 'Any',
  status TEXT DEFAULT 'todo',
  carry INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0,
  updated_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_week ON tasks(week);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('current_week', '2026-07-06');
