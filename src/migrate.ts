import { migrate, openDatabase } from './database.js';
const db = openDatabase(process.env.DATABASE_PATH ?? './data/tasks.sqlite');
try {
  migrate(db);
  console.log('Migraciones aplicadas.');
} finally {
  db.close();
}
