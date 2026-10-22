import assert from 'node:assert/strict';
import test from 'node:test';
import { newDb } from 'pg-mem';

import {
  assertDefaultable,
  formatPairingCode,
  normalizeCountdownSeconds,
  normalizeLibrary,
  normalizeWord,
} from '../server/domain.js';
import {
  createSessionToken,
  hashPairingCode,
  readSessionToken,
} from '../server/security.js';
import { migrateDatabase } from '../server/migration.js';
import { createStore } from '../server/store.js';

async function setupDatabase(options = {}) {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await migrateDatabase(pool);
  return { pool, store: createStore({ pool, ...options }) };
}

test('formats pairing codes with leading zeroes', () => {
  assert.equal(formatPairingCode(42), '0042');
  assert.equal(formatPairingCode(9999), '9999');
});

test('accepts arbitrary unicode text and BCP-47 or auto language', () => {
  assert.deepEqual(normalizeWord({ text: '兵馬俑', hint: '文物名', language: 'zh-CN' }), {
    text: '兵馬俑',
    hint: '文物名',
    language: 'zh-CN',
    rate: 0.72,
  });
  assert.equal(normalizeWord({ text: 'おめでとう', language: 'ja-JP' }).language, 'ja-JP');
  assert.equal(normalizeWord({ text: 'provenance', language: 'auto' }).language, 'auto');
  assert.throws(() => normalizeWord({ text: '', language: 'en-US' }), /invalid_word_text/);
  assert.throws(() => normalizeWord({ text: 'hello', language: 'English' }), /invalid_language/);
});

test('normalizes optional countdown and library names', () => {
  assert.equal(normalizeCountdownSeconds('300'), 300);
  assert.equal(normalizeCountdownSeconds(''), null);
  assert.deepEqual(normalizeLibrary({ name: '  颁奖词库  ', countdownSeconds: '300' }), {
    name: '颁奖词库',
    countdownSeconds: 300,
  });
  assert.throws(() => normalizeCountdownSeconds('12'), /invalid_countdown/);
  assert.throws(() => normalizeCountdownSeconds('20000'), /invalid_countdown/);
  assert.throws(() => normalizeLibrary({ name: '' }), /invalid_library_name/);
});

test('rejects an empty default library', () => {
  assert.throws(() => assertDefaultable({ words: [] }), /empty_library/);
  assert.equal(assertDefaultable({ words: [{ text: 'hello' }] }).words.length, 1);
});

test('hashes pairing codes and signs expiring sessions', () => {
  const codeHash = hashPairingCode('0042', 'pairing-secret');
  assert.match(codeHash, /^[a-f0-9]{64}$/);
  assert.notEqual(codeHash, '0042');

  const token = createSessionToken('user-1', 'session-secret', 1_000, 60_000);
  assert.deepEqual(readSessionToken(token, 'session-secret', 2_000), {
    userId: 'user-1',
    expiresAt: 61_000,
  });
  assert.equal(readSessionToken(`${token}x`, 'session-secret', 2_000), null);
  assert.equal(readSessionToken(token, 'session-secret', 61_001), null);
});

test('persists isolated user libraries and consumes pairings once', async () => {
  let clock = Date.parse('2026-08-26T00:00:00.000Z');
  let sequence = 0;
  const { pool, store } = await setupDatabase({
    now: () => clock,
    randomUUID: () => `id-${++sequence}`,
  });

  try {
    const first = await store.upsertUser({ accountId: 'rokid-1', accountName: '演示用户' });
    const second = await store.upsertUser({ accountId: 'rokid-2', accountName: '另一用户' });
    const library = await store.createLibrary(first.id, { name: '多语言词库', countdownSeconds: 300 });
    await assert.rejects(() => store.setDefaultLibrary(first.id, library.id), /empty_library/);
    await store.addWord(first.id, library.id, { text: 'congratulations', language: 'en-US' });
    await store.addWord(first.id, library.id, { text: '兵馬俑', language: 'zh-CN' });
    await store.addWord(first.id, library.id, { text: 'おめでとう', language: 'ja-JP' });
    const selected = await store.setDefaultLibrary(first.id, library.id);
    assert.equal(selected.words.length, 3);
    assert.equal((await store.getDefaultLibraryByAccount('rokid-1')).name, '多语言词库');
    assert.equal(await store.getDefaultLibraryByAccount('rokid-2'), null);
    await assert.rejects(() => store.updateLibrary(second.id, library.id, { name: '越权' }), /library_not_found/);

    const pairing = await store.createPairing({ userId: first.id, codeHash: 'hash-1', expiresAt: clock + 30_000 });
    assert.equal((await store.consumePairing({ codeHash: 'hash-1' })).id, pairing.id);
    assert.equal(await store.consumePairing({ codeHash: 'hash-1' }), null);

    const users = await pool.query('SELECT COUNT(*) AS count FROM nod_users');
    const libraries = await pool.query('SELECT COUNT(*) AS count FROM nod_libraries');
    const pairingRows = await pool.query('SELECT code_hash, status FROM nod_pairings');
    assert.equal(Number(users.rows[0].count), 2);
    assert.equal(Number(libraries.rows[0].count), 1);
    assert.equal(pairingRows.rows[0].code_hash, 'hash-1');
    assert.equal(pairingRows.rows[0].status, 'consumed');
  } finally {
    await pool.end();
  }
});

test('uses a bound secure UUID generator in the default runtime configuration', async () => {
  const { pool, store } = await setupDatabase();
  try {
    const user = await store.upsertUser({ accountId: 'runtime-account' });
    assert.match(user.id, /^[a-f0-9-]{36}$/);
  } finally {
    await pool.end();
  }
});
