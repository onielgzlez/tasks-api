import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../src/database.ts';
import { TaskRepository } from '../src/tasks.ts';
import { createTaskSchema, querySchema, updateTaskSchema } from '../src/validation.ts';

const input = { title: 'Entrega', description: '', assignee: 'Ana', dueDate: '2026-12-10' };

test('persistencia: CRUD completo, filtros combinados y paginación', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    const tasks = new TaskRepository(db);
    const first = tasks.create(createTaskSchema.parse(input));
    const second = tasks.create(createTaskSchema.parse(input));
    tasks.create(createTaskSchema.parse({ ...input, assignee: 'Luis' }));
    tasks.create(createTaskSchema.parse({ ...input, status: 'hecha' }));
    assert.equal(first.status, 'pendiente');
    assert.deepEqual(tasks.get(first.id), first);
    const page = tasks.list(querySchema.parse({ assignee: 'Ana', status: 'pendiente', limit: '1', page: '2' }));
    assert.deepEqual(page.data.map(task => task.id), [second.id]);
    assert.equal(page.meta.total, 2);
    assert.equal(page.meta.totalPages, 2);
    assert.equal(tasks.update(first.id, { status: 'hecha' })!.title, input.title);
    assert.equal(tasks.get(first.id)!.status, 'hecha');
    assert.equal(tasks.list(querySchema.parse({ assignee: "' OR 1=1 --" })).meta.total, 0);
    assert.equal(tasks.delete(first.id), true);
    assert.equal(tasks.delete(first.id), false);
    assert.equal(tasks.get(first.id), undefined);
    assert.equal(tasks.update(first.id, { title: 'Ausente' }), undefined);
  } finally { db.close(); }
});

test('validación: fechas reales, límites y campos desconocidos', () => {
  assert.equal(createTaskSchema.parse({ ...input, title: '  Entrega  ' }).title, 'Entrega');
  assert.ok(createTaskSchema.safeParse({ ...input, dueDate: '2024-02-29' }).success);
  for (const changes of [{ title: ' ' }, { dueDate: '2026-02-29' }, { dueDate: '2026-04-31' }, { assignee: null }, { extra: true }, { description: 'a'.repeat(5001) }]) {
    assert.equal(createTaskSchema.safeParse({ ...input, ...changes }).success, false);
  }
  assert.equal(updateTaskSchema.safeParse({}).success, false);
  assert.equal(updateTaskSchema.safeParse({ status: null }).success, false);
  assert.equal(updateTaskSchema.safeParse({ status: 'en_curso' }).success, true);
});

test('validación: paginación acotada y parámetros repetidos rechazados', () => {
  assert.deepEqual(querySchema.parse({}), { page: 1, limit: 20 });
  for (const query of [{ page: '0' }, { page: '1.5' }, { limit: '101' }, { limit: ['1', '2'] }, { status: 'otro' }, { unknown: 'x' }]) {
    assert.equal(querySchema.safeParse(query).success, false);
  }
});
