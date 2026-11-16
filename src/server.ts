import { createApp } from './app.ts';
import { openDatabase } from './database.ts';
import { readConfig } from './config.ts';
import { createServer } from 'node:http';

const config = readConfig(process.env);
const port = config.PORT;
const db = openDatabase(config.DATABASE_PATH);
try {
  db.prepare('SELECT id FROM tasks LIMIT 1').get();
} catch (error) {
  db.close();
  throw new Error('Base de datos sin preparar. Ejecuta pnpm migrate.', { cause: error });
}
const host = config.HOST;
const app = createApp(db, {
  apiToken: config.API_TOKEN,
  requestsPerMinute: config.REQUESTS_PER_MINUTE,
  maxTasks: config.MAX_TASKS,
});
const server = createServer(
  {
    maxHeaderSize: 8192,
    headersTimeout: 10_000,
    requestTimeout: 15_000,
    keepAliveTimeout: 5000,
    connectionsCheckingInterval: 1000,
  },
  app,
);
server.maxRequestsPerSocket = 100;
server.listen(port, host, () => console.log(`Tasks API: http://${host}:${port}/api/tasks`));
server.on('error', (error) => {
  console.error(error);
  db.close();
  process.exitCode = 1;
});
let closing = false;
function shutdown() {
  if (closing) {
    return;
  }
  closing = true;
  const timeout = setTimeout(() => {
    server.closeAllConnections();
  }, 10_000);
  timeout.unref();
  server.close(() => {
    clearTimeout(timeout);
    db.close();
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
