import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate, openDatabase } from '../src/database.ts';
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
