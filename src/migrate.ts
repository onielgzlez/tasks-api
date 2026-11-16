import { migrate, openDatabase } from './database.ts';
const db = openDatabase(process.env.DATABASE_PATH ?? './data/tasks.sqlite');
try {
  migrate(db);
  console.log('Migraciones aplicadas.');
} finally {
  db.close();
}
