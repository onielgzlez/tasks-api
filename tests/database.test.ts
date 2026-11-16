import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDatabaseBusy, migrate, openDatabase } from '../src/database.ts';
import { TaskRepository } from '../src/tasks.ts';

test('migraciones repetibles y persistencia al reabrir la base', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tasks-test-'));
  const path = join(directory, 'tasks.sqlite');
  let db = openDatabase(path);
  try {
    migrate(db); migrate(db);
    const task = new TaskRepository(db).create({ title: 'Persistir', description: '', status: 'pendiente', assignee: 'Ana', dueDate: '2026-12-10' });
    db.close(); db = openDatabase(path); migrate(db);
    assert.deepEqual(new TaskRepository(db).get(task.id), task);
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('una migración fallida revierte el esquema y se detectan cambios posteriores', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tasks-migrations-'));
  const url = pathToFileURL(`${directory}/`);
  const db = openDatabase(':memory:');
  try {
    writeFileSync(join(directory, '001_test.sql'), 'CREATE TABLE example(id INTEGER); INVALID SQL;');
    assert.throws(() => migrate(db, url));
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='example'").get(), undefined);
    writeFileSync(join(directory, '001_test.sql'), 'CREATE TABLE example(id INTEGER);');
    migrate(db, url);
    writeFileSync(join(directory, '001_test.sql'), 'CREATE TABLE changed(id INTEGER);');
    assert.throws(() => migrate(db, url), /Applied migration changed/);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('una escritura bloqueada falla de inmediato y se recupera al liberar el bloqueo', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tasks-lock-'));
  const path = join(directory, 'tasks.sqlite');
  const db = openDatabase(path);
  let other: ReturnType<typeof openDatabase> | undefined;
  try {
    migrate(db);
    other = openDatabase(path);
    // No timed assertion: the configured zero wait is deterministic on slow CI hosts.
    assert.equal(db.prepare('PRAGMA busy_timeout').get()!.timeout, 0);
    other.exec('BEGIN IMMEDIATE');
    const tasks = new TaskRepository(db);
    const input = { title: 'Entrega', description: '', status: 'pendiente' as const, assignee: 'Ana', dueDate: '2026-12-10' };
    assert.throws(() => tasks.create(input), (error: unknown) => {
      assert.ok(error instanceof Error && 'errcode' in error);
      assert.equal(Number(error.errcode) & 0xff, 5);
      assert.equal(isDatabaseBusy(error), true);
      return true;
    });
    assert.equal(tasks.list({ page: 1, limit: 20 }).meta.total, 0);
    other.exec('ROLLBACK');
    const saved = tasks.create(input);
    assert.equal(tasks.get(saved.id)!.title, input.title);
  } finally { other?.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('solo los errores SQLITE_BUSY se consideran conflictos temporales', () => {
  for (const errcode of [5, 261, 517, 773]) {
    assert.equal(isDatabaseBusy(Object.assign(new Error('busy'), { code: 'ERR_SQLITE_ERROR', errcode })), true);
  }
  for (const error of [null, new Error('database is locked'),
    Object.assign(new Error('locked'), { code: 'ERR_SQLITE_ERROR', errcode: 6 }),
    Object.assign(new Error('constraint'), { code: 'ERR_SQLITE_ERROR', errcode: 19 })]) {
    assert.equal(isDatabaseBusy(error), false);
  }
});
