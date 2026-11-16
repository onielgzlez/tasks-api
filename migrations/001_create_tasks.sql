CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK(length(description) <= 5000),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'en_curso', 'hecha')),
  assignee TEXT NOT NULL CHECK(length(trim(assignee)) BETWEEN 1 AND 100),
  due_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX tasks_status_id ON tasks(status, id);
CREATE INDEX tasks_assignee_status_id ON tasks(assignee, status, id);
