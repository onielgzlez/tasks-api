import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Task, TaskInput, TaskQuery } from './validation.js';

const columns = `id, title, description, status, assignee, due_date AS dueDate,
  created_at AS createdAt, updated_at AS updatedAt`;

export class TaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: TaskInput): Task {
    return this.db.prepare(`INSERT INTO tasks(title, description, status, assignee, due_date)
      VALUES (?, ?, ?, ?, ?) RETURNING ${columns}`)
      .get(input.title, input.description, input.status, input.assignee, input.dueDate) as Task;
  }

  get(id: number): Task | undefined {
    return this.db.prepare(`SELECT ${columns} FROM tasks WHERE id = ?`).get(id) as Task | undefined;
  }

  list(query: TaskQuery) {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.status) { conditions.push('status = ?'); params.push(query.status); }
    if (query.assignee) { conditions.push('assignee = ?'); params.push(query.assignee); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // Count and page share one snapshot, including with another database connection writing.
    this.db.exec('BEGIN');
    try {
      const { total } = this.db.prepare(`SELECT count(*) AS total FROM tasks ${where}`).get(...params) as { total: number };
      const data = this.db.prepare(`SELECT ${columns} FROM tasks ${where} ORDER BY id ASC LIMIT ? OFFSET ?`)
        .all(...params, query.limit, (query.page - 1) * query.limit) as Task[];
      this.db.exec('COMMIT');
      return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  update(id: number, input: Partial<TaskInput>): Task | undefined {
    const mapping = { title: 'title', description: 'description', status: 'status', assignee: 'assignee', dueDate: 'due_date' } as const;
    const entries = Object.entries(input) as [keyof TaskInput, string][];
    return this.db.prepare(`UPDATE tasks SET ${entries.map(([key]) => `${mapping[key]} = ?`).join(', ')},
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? RETURNING ${columns}`)
      .get(...entries.map(([, value]) => value), id) as Task | undefined;
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes === 1;
  }
}
