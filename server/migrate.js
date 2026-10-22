import pg from 'pg';

import { migrateDatabase } from './migration.js';

const databaseURL = String(process.env.DATABASE_URL || '').trim();
if (!databaseURL) throw new Error('DATABASE_URL is required');

const pool = new pg.Pool({ connectionString: databaseURL });

try {
  await migrateDatabase(pool);
  console.log('[nod-pronouncer] database migrations applied');
} finally {
  await pool.end();
}
