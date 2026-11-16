import { createApp } from './app.ts';
import { openDatabase } from './database.ts';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe estar entre 1 y 65535.');
const db = openDatabase(process.env.DATABASE_PATH ?? './data/tasks.sqlite');
try {
  db.prepare('SELECT id FROM tasks LIMIT 1').get();
} catch (error) {
  db.close();
  throw new Error('Base de datos sin preparar. Ejecuta pnpm migrate.', { cause: error });
}
const host = process.env.HOST ?? '127.0.0.1';
const server = createApp(db).listen(port, host, () => console.log(`Tasks API: http://${host}:${port}/api/tasks`));
server.on('error', error => { console.error(error); db.close(); process.exitCode = 1; });
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => { server.closeAllConnections(); }, 10_000);
  timeout.unref();
  server.close(() => { clearTimeout(timeout); db.close(); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
