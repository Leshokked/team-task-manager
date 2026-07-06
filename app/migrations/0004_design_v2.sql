ALTER TABLE tasks ADD COLUMN prio TEXT DEFAULT 'medium';
UPDATE tasks SET status='progress' WHERE status='partial';
UPDATE tasks SET prio='urgent', status='todo' WHERE status='blocked';
