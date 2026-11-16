import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp, type AppOptions } from '../src/app.ts';
import { openDatabase, migrate } from '../src/database.ts';
import { readConfig } from '../src/config.ts';

const apiToken = randomBytes(32).toString('hex');
const input = { title: 'Protegida', description: '', assignee: 'Ana', dueDate: '2026-12-10' };
const authorization = { Authorization: `Bearer ${apiToken}` };

async function withApp(options: Partial<AppOptions>, run: (base: string) => Promise<void>) {
  const db = openDatabase(':memory:');
  migrate(db);
  const server = createApp(db, { apiToken, logError: () => {}, ...options }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
}

async function create(base: string) {
  return fetch(base + '/api/tasks', {
    method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

test('todas las rutas CRUD exigen una credencial válida sin filtrar secretos', async () => {
  await withApp({}, async base => {
    const created = await create(base);
    assert.equal(created.status, 201);
    const task = await created.json();
    for (const [method, path] of [
      ['GET', '/api/tasks'], ['GET', `/api/tasks/${task.id}`], ['POST', '/api/tasks'],
      ['PATCH', `/api/tasks/${task.id}`], ['DELETE', `/api/tasks/${task.id}`],
    ]) {
      for (const credential of [undefined, `Bearer ${'0'.repeat(64)}`, `Basic ${apiToken}`, `Bearer ${apiToken}extra`]) {
        const response = await fetch(base + path, {
          method, headers: credential ? { Authorization: credential } : {},
        });
        assert.equal(response.status, 401);
        assert.match(response.headers.get('www-authenticate')!, /^Bearer /);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.match(response.headers.get('content-type')!, /application\/problem\+json/);
        assert.ok(!(await response.text()).includes(apiToken));
      }
    }
    const read = await fetch(base + `/api/tasks/${task.id}`, { headers: authorization });
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), task);
  });
});

test('no acepta tokens en query, cookies ni cabeceras Authorization duplicadas', async () => {
  await withApp({}, async base => {
    const query = await fetch(base + `/api/tasks?token=${apiToken}`, { headers: { Cookie: `API_TOKEN=${apiToken}` } });
    assert.equal(query.status, 401);
    assert.ok(!(await query.text()).includes(apiToken));
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(base + '/api/tasks', {
        headers: ['Host', new URL(base).host, 'Authorization', `Bearer ${apiToken}`, 'Authorization', `Bearer ${apiToken}`],
      }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 401);
  });
});

test('autentica antes de parsear el JSON y rechaza credenciales inválidas', async () => {
  await withApp({}, async base => {
    const response = await fetch(base + '/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(response.status, 401);
    await response.text();
    const valid = await fetch(base + '/api/tasks', { headers: { Authorization: `bearer ${apiToken}` } });
    assert.equal(valid.status, 200);
    await valid.text();
  });
});

test('el límite global devuelve 429 y Retry-After incluso al falsificar la IP', async () => {
  await withApp({ requestsPerMinute: 2 }, async base => {
    for (let index = 0; index < 2; index++) {
      const response = await fetch(base + '/api/tasks', { headers: authorization });
      assert.equal(response.status, 200); await response.text();
    }
    const blocked = await fetch(base + '/api/tasks', { headers: { ...authorization, 'X-Forwarded-For': '203.0.113.99' } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.ok(blocked.headers.get('ratelimit'));
    assert.equal((await blocked.json()).status, 429);
  });
});

test('los intentos sin autenticar también consumen el límite de peticiones', async () => {
  await withApp({ requestsPerMinute: 1 }, async base => {
    const first = await fetch(base + '/api/tasks');
    assert.equal(first.status, 401); await first.text();
    const second = await fetch(base + '/api/tasks');
    assert.equal(second.status, 429); await second.text();
  });
});

test('la cuota de tareas evita crecimiento ilimitado y permite liberar espacio', async () => {
  await withApp({ maxTasks: 1 }, async base => {
    const first = await create(base); assert.equal(first.status, 201);
    const task = await first.json();
    const second = await create(base); assert.equal(second.status, 409);
    assert.equal((await second.json()).status, 409);
    const list = await fetch(base + '/api/tasks', { headers: authorization });
    assert.equal((await list.json()).meta.total, 1);
    assert.equal((await fetch(base + `/api/tasks/${task.id}`, { method: 'DELETE', headers: authorization })).status, 204);
    const third = await create(base); assert.equal(third.status, 201); await third.text();
  });
});

test('el arranque exige una clave fuerte y límites positivos sin mostrar valores secretos', () => {
  for (const value of [undefined, '', 'short', 'z'.repeat(64)]) {
    assert.throws(() => readConfig({ API_TOKEN: value }), /Configuración inválida: API_TOKEN/);
  }
  const config = readConfig({ API_TOKEN: apiToken });
  assert.equal(config.HOST, '127.0.0.1');
  assert.equal(config.REQUESTS_PER_MINUTE, 300);
  assert.equal(config.MAX_TASKS, 10_000);
  for (const overrides of [{ PORT: '0' }, { REQUESTS_PER_MINUTE: '-1' }, { MAX_TASKS: '0' }, { MAX_TASKS: '1.5' }]) {
    assert.throws(() => readConfig({ API_TOKEN: apiToken, ...overrides }), error => {
      assert.ok(error instanceof Error && !error.message.includes(apiToken)); return true;
    });
  }
  const db = openDatabase(':memory:');
  try { assert.throws(() => createApp(db, { apiToken: '' }), /API_TOKEN/); }
  finally { db.close(); }
});
