import assert from 'node:assert/strict';
import test from 'node:test';
import { newDb } from 'pg-mem';

import { migrateDatabase } from '../server/migration.js';
import { createStore } from '../server/store.js';

async function setupDatabase() {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await migrateDatabase(pool);
  return { pool, store: createStore({ pool }) };
}

test('persists users and libraries through the PostgreSQL store', async () => {
  const { pool, store } = await setupDatabase();
  try {
    const user = await store.upsertUser({ accountId: 'rokid-1', accountName: '演示用户' });
    const library = await store.createLibrary(user.id, {
      name: '演讲词库',
      countdownSeconds: 300,
    });
    await store.addWord(user.id, library.id, { text: 'MeetLens', language: 'en-US' });
    await store.setDefaultLibrary(user.id, library.id);

    const persisted = await store.getDefaultLibraryByAccount('rokid-1');
    assert.equal(persisted.name, '演讲词库');
    assert.deepEqual(persisted.words.map((word) => word.text), ['MeetLens']);
  } finally {
    await pool.end();
  }
});
