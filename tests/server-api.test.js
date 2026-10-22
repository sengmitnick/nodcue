import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { newDb } from 'pg-mem';

import { createApp } from '../server/app.js';
import { migrateDatabase } from '../server/migration.js';
import { createStore } from '../server/store.js';

async function setupServer() {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await migrateDatabase(pool);
  let clock = Date.parse('2026-08-26T00:00:00.000Z');
  let sequence = 0;
  let nextCode = 42;
  const store = createStore({
    pool,
    now: () => clock,
    randomUUID: () => `id-${++sequence}`,
  });
  const server = http.createServer(createApp({
    store,
    clientKey: 'test-client',
    sessionSecret: 'test-session-secret',
    now: () => clock,
    randomInt: () => nextCode++,
    publicDir: path.resolve('server/public'),
    secureCookies: true,
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    store,
    baseURL: `http://127.0.0.1:${address.port}`,
    advance(ms) { clock += ms; },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await pool.end();
    },
  };
}

async function request(context, pathname, { method = 'GET', body, cookie, client = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (client) headers['x-nod-client-key'] = 'test-client';
  const response = await fetch(`${context.baseURL}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, body: data };
}

async function pairAndLogin(context, accountId = 'rokid-1') {
  const pairing = await request(context, '/api/v1/pairing-codes', {
    method: 'POST',
    client: true,
    body: { accountId, accountName: `用户 ${accountId}` },
  });
  assert.equal(pairing.response.status, 200);
  assert.match(pairing.body.code, /^\d{4}$/);
  const login = await request(context, '/api/auth/pairing-code', {
    method: 'POST',
    body: { code: pairing.body.code },
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie')?.split(';')[0];
  assert.match(cookie, /^nod_session=/);
  return { pairing: pairing.body, cookie };
}

test('serves static root metadata to HEAD requests', async () => {
  const context = await setupServer();
  try {
    const root = await request(context, '/', { method: 'HEAD' });
    assert.equal(root.response.status, 200);
    assert.match(root.response.headers.get('content-type'), /^text\/html/);
  } finally {
    await context.close();
  }
});

test('pairing code logs a browser in once and reports consumed status', async () => {
  const context = await setupServer();
  try {
    const health = await request(context, '/healthz');
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { ok: true });

    const pairing = await request(context, '/api/v1/pairing-codes', {
      method: 'POST',
      client: true,
      body: { accountId: 'rokid-1', accountName: '演示用户' },
    });
    assert.equal(pairing.response.status, 200);
    assert.equal(pairing.body.code, '0042');
    assert.equal(pairing.body.expiresAt, '2026-08-26T00:00:30.000Z');

    const login = await request(context, '/api/auth/pairing-code', {
      method: 'POST',
      body: { code: '0042' },
    });
    assert.equal(login.response.status, 200);
    assert.match(login.response.headers.get('set-cookie'), /; Secure/);
    const cookie = login.response.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie, /^nod_session=/);

    const me = await request(context, '/api/me', { cookie });
    assert.equal(me.response.status, 200);
    assert.equal(me.body.user.accountName, '演示用户');
    assert.equal(me.body.user.accountId, undefined);

    const status = await request(context, `/api/v1/pairing-codes/${pairing.body.publicId}/status`, {
      method: 'POST',
      client: true,
      body: { accountId: 'rokid-1' },
    });
    assert.equal(status.body.status, 'consumed');

    const replay = await request(context, '/api/auth/pairing-code', {
      method: 'POST',
      body: { code: '0042' },
    });
    assert.equal(replay.response.status, 401);
    assert.equal(replay.body.error, 'invalid_pairing_code');
  } finally {
    await context.close();
  }
});

test('pairing rejects unauthorized clients, refreshed codes, and expired codes', async () => {
  const context = await setupServer();
  try {
    const unauthorized = await request(context, '/api/v1/pairing-codes', {
      method: 'POST',
      body: { accountId: 'rokid-1' },
    });
    assert.equal(unauthorized.response.status, 401);

    const first = await request(context, '/api/v1/pairing-codes', {
      method: 'POST', client: true, body: { accountId: 'rokid-1' },
    });
    const second = await request(context, '/api/v1/pairing-codes', {
      method: 'POST', client: true, body: { accountId: 'rokid-1' },
    });
    assert.notEqual(first.body.code, second.body.code);
    const oldCode = await request(context, '/api/auth/pairing-code', {
      method: 'POST', body: { code: first.body.code },
    });
    assert.equal(oldCode.response.status, 401);

    context.advance(30_001);
    const expired = await request(context, '/api/auth/pairing-code', {
      method: 'POST', body: { code: second.body.code },
    });
    assert.equal(expired.response.status, 401);
  } finally {
    await context.close();
  }
});

test('library API stores multilingual words and exposes only the default library to glasses', async () => {
  const context = await setupServer();
  try {
    const { cookie } = await pairAndLogin(context);
    const created = await request(context, '/api/libraries', {
      method: 'POST', cookie, body: { name: '多语言词库', countdownSeconds: null },
    });
    assert.equal(created.response.status, 201);
    const libraryId = created.body.library.id;

    const emptyDefault = await request(context, `/api/libraries/${libraryId}/default`, {
      method: 'POST', cookie,
    });
    assert.equal(emptyDefault.response.status, 409);
    assert.equal(emptyDefault.body.error, 'empty_library');

    for (const word of [
      { text: 'congratulations', hint: '祝贺', language: 'en-US' },
      { text: '兵馬俑', hint: '文物名', language: 'zh-CN' },
      { text: 'おめでとう', hint: '恭喜', language: 'ja-JP' },
    ]) {
      const response = await request(context, `/api/libraries/${libraryId}/words`, {
        method: 'POST', cookie, body: word,
      });
      assert.equal(response.response.status, 201);
    }

    const updated = await request(context, `/api/libraries/${libraryId}`, {
      method: 'PATCH', cookie, body: { countdownSeconds: 300 },
    });
    assert.equal(updated.body.library.countdownSeconds, 300);
    const selected = await request(context, `/api/libraries/${libraryId}/default`, {
      method: 'POST', cookie,
    });
    assert.equal(selected.response.status, 200);

    const synced = await request(context, '/api/v1/default-library', {
      method: 'POST', client: true, body: { accountId: 'rokid-1' },
    });
    assert.equal(synced.response.status, 200);
    assert.equal(synced.body.library.name, '多语言词库');
    assert.equal(synced.body.library.countdownSeconds, 300);
    assert.deepEqual(synced.body.library.words.map((word) => word.language), ['en-US', 'zh-CN', 'ja-JP']);
    assert.equal(synced.body.library.userId, undefined);

    const libraries = await request(context, '/api/libraries', { cookie });
    assert.equal(libraries.body.libraries.length, 1);
    assert.equal(libraries.body.defaultLibraryId, libraryId);
  } finally {
    await context.close();
  }
});

test('library ownership is isolated between paired users', async () => {
  const context = await setupServer();
  try {
    const first = await pairAndLogin(context, 'rokid-1');
    const created = await request(context, '/api/libraries', {
      method: 'POST', cookie: first.cookie, body: { name: '私有词库' },
    });
    const second = await pairAndLogin(context, 'rokid-2');
    const update = await request(context, `/api/libraries/${created.body.library.id}`, {
      method: 'PATCH', cookie: second.cookie, body: { name: '越权修改' },
    });
    assert.equal(update.response.status, 404);
    assert.equal(update.body.error, 'library_not_found');
  } finally {
    await context.close();
  }
});
