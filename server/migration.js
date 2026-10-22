import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrateDatabase(pool, { directory = defaultDirectory } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('database_pool_required');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nod_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = (await readdir(directory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const name of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const applied = await client.query('SELECT 1 FROM nod_migrations WHERE name = $1', [name]);
      if (!applied.rowCount) {
        await client.query(await readFile(path.join(directory, name), 'utf8'));
        await client.query('INSERT INTO nod_migrations (name) VALUES ($1)', [name]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
