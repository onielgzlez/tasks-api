import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { createApp } from '../src/app.ts';
import { migrate, openDatabase } from '../src/database.ts';

const apiToken = randomBytes(32).toString('hex');
let db: ReturnType<typeof openDatabase>;
let server: Server;
let base: string;
let directory: string;
const input = {
  title: 'Preparar entrega',
  description: 'Revisar contrato HTTP',
  assignee: 'Ana',
  dueDate: '2026-12-10',
};
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'tasks-http-'));
  db = openDatabase(join(directory, 'tasks.sqlite'));
  migrate(db);
  server = createApp(db, { apiToken, logError: () => {} }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  db?.close();
  if (directory) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function authenticatedFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${apiToken}`);
  return fetch(url, { ...init, headers });
}
async function api(method: string, path: string, status: number, body?: unknown) {
  const response = await authenticatedFetch(base + path, {
    method,
    ...(body !== undefined
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  assert.equal(response.status, status);
  if (status === 204) {
    assert.equal(await response.text(), '');
    return;
  }
  if (status >= 400) {
    assert.match(response.headers.get('content-type')!, /application\/problem\+json/);
  }
  return response.json();
}

test('crear, consultar, editar y borrar una tarea', async () => {
  const response = await authenticatedFetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  const url = `/api/tasks/${created.id}`;
  assert.equal(response.headers.get('location'), url);
  assert.equal(created.status, 'pendiente');
  assert.deepEqual(await api('GET', url, 200), created);
  const updated = await api('PATCH', url, 200, { status: 'hecha' });
  assert.equal(updated.status, 'hecha');
  assert.equal(updated.title, input.title);
  await api('DELETE', url, 204);
  await api('GET', url, 404);
});

test('combina filtros y pagina con total filtrado y orden estable', async () => {
  for (const overrides of [{}, {}, { status: 'hecha' }, { assignee: 'Luis' }]) {
    await api('POST', '/api/tasks', 201, { ...input, ...overrides });
  }
  const first = await api('GET', '/api/tasks?status=pendiente&assignee=Ana&limit=1', 200);
  const second = await api('GET', '/api/tasks?status=pendiente&assignee=Ana&limit=1&page=2', 200);
  assert.deepEqual(first.meta, { page: 1, limit: 1, total: 2, totalPages: 2 });
  assert.equal(first.data.length, 1);
  assert.ok(first.data[0].id < second.data[0].id);
  assert.deepEqual((await api('GET', '/api/tasks?page=99', 200)).data, []);
  assert.equal((await api('GET', '/api/tasks?status=hecha', 200)).meta.total, 1);
  assert.equal((await api('GET', '/api/tasks?assignee=Luis', 200)).meta.total, 1);
});

test('rechaza datos inválidos sin insertar tareas', async () => {
  for (const body of [
    {},
    { ...input, title: '  ' },
    { ...input, status: 'otro' },
    { ...input, dueDate: '2026-02-30' },
    { ...input, assignee: null },
    { ...input, unknown: true },
  ]) {
    assert.ok((await api('POST', '/api/tasks', 422, body)).errors.length);
  }
  assert.equal((await api('GET', '/api/tasks', 200)).meta.total, 0);
});

test('valida PATCH, parámetros y filtros estrictamente', async () => {
  const task = await api('POST', '/api/tasks', 201, input);
  for (const patch of [{}, { title: '' }, { id: 99 }, { status: null }]) {
    await api('PATCH', `/api/tasks/${task.id}`, 422, patch);
  }
  for (const query of [
    'page=0',
    'limit=101',
    'page=1.5',
    'status=otro',
    'limit=2&limit=3',
    'other=x',
    'assignee=',
  ]) {
    await api('GET', `/api/tasks?${query}`, 400);
  }
  for (const id of ['abc', '0', '-1', '1.5', '9007199254740992']) {
    await api('GET', `/api/tasks/${id}`, 400);
  }
});

test('devuelve 404 coherente para recursos y rutas inexistentes', async () => {
  await api('GET', '/api/tasks/999', 404);
  await api('PATCH', '/api/tasks/999', 404, { title: 'Otro' });
  await api('DELETE', '/api/tasks/999', 404);
  await api('GET', '/missing', 404);
});

test('distingue JSON mal formado, tipo no soportado y cuerpo demasiado grande', async () => {
  assert.equal(
    (
      await authenticatedFetch(base + '/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await authenticatedFetch(base + '/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'hola',
      })
    ).status,
    415,
  );
  await api('POST', '/api/tasks', 413, { ...input, description: 'x'.repeat(40_000) });
});

test('los filtros tratan SQL como texto', async () => {
  await api('POST', '/api/tasks', 201, input);
  const query = new URLSearchParams({ assignee: "' OR 1=1 --" });
  assert.equal((await api('GET', `/api/tasks?${query}`, 200)).meta.total, 0);
  assert.equal((await api('GET', '/api/tasks', 200)).meta.total, 1);
});

test('los errores inesperados no filtran detalles internos', async () => {
  db.exec('DROP TABLE tasks');
  const response = await api('GET', '/api/tasks', 500);
  assert.equal(response.title, 'Error interno del servidor.');
  assert.ok(!JSON.stringify(response).includes('SQLITE'));
});

test('rechaza caracteres nulos con 422 sin modificar la tarea', async () => {
  const task = await api('POST', '/api/tasks', 201, input);
  for (const field of ['title', 'description', 'assignee']) {
    await api('POST', '/api/tasks', 422, { ...input, [field]: '\u0000hola' });
    await api('PATCH', `/api/tasks/${task.id}`, 422, { [field]: 'hola\u0000' });
  }
  assert.deepEqual(await api('GET', `/api/tasks/${task.id}`, 200), task);
  assert.equal((await api('GET', '/api/tasks', 200)).meta.total, 1);
});

test('un bloqueo externo devuelve 503 y Retry-After sin insertar ni impedir lecturas', async () => {
  const other = openDatabase(join(directory, 'tasks.sqlite'));
  try {
    other.exec('BEGIN IMMEDIATE');
    const response = await authenticatedFetch(base + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.match(response.headers.get('content-type')!, /application\/problem\+json/);
    assert.equal((await response.json()).status, 503);
    assert.equal((await api('GET', '/api/tasks', 200)).meta.total, 0);
    other.exec('ROLLBACK');
    await api('POST', '/api/tasks', 201, input);
    assert.equal((await api('GET', '/api/tasks', 200)).meta.total, 1);
  } finally {
    other.close();
  }
});

test('SQL malicioso se conserva como texto en creación y edición sin cambiar otras filas', async () => {
  const control = await api('POST', '/api/tasks', 201, input);
  const payloads = [
    "' OR 1=1 --",
    "'); DROP TABLE tasks; --",
    "x', status='hecha' WHERE 1=1 --",
    "' UNION SELECT * FROM schema_migrations --",
  ];
  for (const value of payloads) {
    const created = await api('POST', '/api/tasks', 201, {
      ...input,
      title: value,
      description: value,
      assignee: value,
    });
    assert.equal(created.title, value);
    assert.equal(created.description, value);
    const matches = await api('GET', `/api/tasks?${new URLSearchParams({ assignee: value })}`, 200);
    assert.equal(matches.meta.total, 1);
    assert.equal(matches.data[0].id, created.id);
    const updated = await api('PATCH', `/api/tasks/${created.id}`, 200, {
      title: value,
      description: value,
    });
    assert.equal(updated.title, value);
    assert.equal(updated.status, 'pendiente');
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      await api(
        method,
        `/api/tasks/${encodeURIComponent('1 OR 1=1')}`,
        400,
        method === 'PATCH' ? { title: value } : undefined,
      );
    }
    await api('PATCH', `/api/tasks/${created.id}`, 422, { [value]: 'x' });
  }
  assert.deepEqual(await api('GET', `/api/tasks/${control.id}`, 200), control);
  assert.equal((await api('GET', '/api/tasks', 200)).meta.total, payloads.length + 1);
});

test('rechaza contaminación del prototipo y asignación de campos protegidos', async () => {
  const control = await api('POST', '/api/tasks', 201, input);
  for (const patch of [
    JSON.parse('{"__proto__":{"polluted":true}}'),
    { constructor: { prototype: { polluted: true } } },
    { id: 999 },
    { createdAt: 'x' },
    { updatedAt: 'x' },
  ]) {
    await api('PATCH', `/api/tasks/${control.id}`, 422, patch);
  }
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  assert.deepEqual(await api('GET', `/api/tasks/${control.id}`, 200), control);
});

test('una URL mal codificada devuelve 400 y no revela detalles internos', async () => {
  const response = await api('GET', '/api/tasks/%E0%A4%A', 400);
  assert.equal(response.title, 'URL mal formada.');
  assert.ok(!JSON.stringify(response).includes('URIError'));
  await api('GET', '/api/tasks', 200);
});

test('rechaza cuerpos comprimidos antes de descomprimirlos y sigue disponible', async () => {
  for (const [encoding, compress] of [
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ] as const) {
    const compressed = compress(Buffer.from(JSON.stringify(input)));
    const response = await authenticatedFetch(base + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding },
      body: Buffer.concat([compressed, Buffer.from('trailing bytes')]),
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).status, 415);
  }
  assert.equal((await api('GET', '/api/tasks', 200)).meta.total, 0);
  await api('POST', '/api/tasks', 201, input);
});
