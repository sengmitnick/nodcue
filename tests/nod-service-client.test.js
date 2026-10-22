import assert from 'node:assert/strict';
import test from 'node:test';

import { createNodServiceClient } from '../src/lib/nod-service.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('creates and observes a pairing code with the restricted client credential', async () => {
  const requests = [];
  const client = createNodServiceClient({
    baseURL: 'http://127.0.0.1:3100/',
    clientKey: 'test-client',
    storage: createStorage(),
    fetch: async (url, init) => {
      requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      if (url.endsWith('/api/v1/pairing-codes')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            publicId: 'pair-1',
            code: '0042',
            expiresAt: '2026-08-26T00:00:30.000Z',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'consumed', expiresAt: '2026-08-26T00:00:30.000Z' }),
      };
    },
  });

  assert.deepEqual(await client.createPairingCode({ accountId: 'rokid-1', accountName: '演示用户' }), {
    publicId: 'pair-1',
    code: '0042',
    expiresAt: '2026-08-26T00:00:30.000Z',
  });
  assert.deepEqual(await client.readPairingStatus({ accountId: 'rokid-1', publicId: 'pair-1' }), {
    status: 'consumed',
    expiresAt: '2026-08-26T00:00:30.000Z',
  });
  assert.equal(requests[0].url, 'http://127.0.0.1:3100/api/v1/pairing-codes');
  assert.equal(requests[0].headers['x-nod-client-key'], 'test-client');
  assert.equal(requests[0].headers['ngrok-skip-browser-warning'], undefined);
  assert.deepEqual(requests[0].body, { accountId: 'rokid-1', accountName: '演示用户' });
  assert.deepEqual(requests[1].body, { accountId: 'rokid-1' });
});

test('syncs and caches a multilingual default library', async () => {
  const storage = createStorage();
  const library = {
    id: 'library-1',
    name: '多语言词库',
    countdownSeconds: 300,
    updatedAt: '2026-08-26T00:00:00.000Z',
    words: [
      { id: 'w1', text: 'congratulations', hint: '祝贺', language: 'en-US', rate: 0.72 },
      { id: 'w2', text: '兵馬俑', hint: '文物名', language: 'zh-CN', rate: 0.72 },
      { id: 'w3', text: 'おめでとう', hint: '恭喜', language: 'ja-JP', rate: 0.72 },
    ],
  };
  const client = createNodServiceClient({
    baseURL: 'http://127.0.0.1:3100',
    clientKey: 'test-client',
    storage,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, library }) }),
  });

  assert.deepEqual(await client.readDefaultLibrary({ accountId: 'rokid-1' }), library);
  assert.deepEqual(
    await client.readDefaultLibraryResult({ accountId: 'rokid-1' }),
    { status: 'ready', library },
  );
  assert.deepEqual(client.readCachedDefaultLibrary({ accountId: 'rokid-1' }), library);
  assert.equal(client.readCachedDefaultLibrary({ accountId: 'rokid-2' }), null);
});

test('network and malformed responses degrade to null without destroying cache', async () => {
  const cached = {
    id: 'cached',
    name: '离线词库',
    countdownSeconds: null,
    words: [{ id: 'w1', text: 'bonjour', hint: '', language: 'fr-FR', rate: 0.72 }],
  };
  const storage = createStorage({
    nodDefaultLibrary: JSON.stringify({ accountId: 'rokid-1', library: cached }),
  });
  const client = createNodServiceClient({
    baseURL: 'http://127.0.0.1:3100',
    clientKey: 'test-client',
    storage,
    fetch: async () => { throw new Error('offline'); },
    logger: { warn() {} },
  });

  assert.equal(await client.createPairingCode({ accountId: 'rokid-1' }), null);
  assert.equal(await client.readPairingStatus({ accountId: 'rokid-1', publicId: 'pair-1' }), null);
  assert.equal(await client.readDefaultLibrary({ accountId: 'rokid-1' }), null);
  assert.deepEqual(client.readCachedDefaultLibrary({ accountId: 'rokid-1' }), cached);
  assert.equal(client.readCachedDefaultLibrary({ accountId: 'rokid-2' }), null);
});

test('reports whether a refreshed default library is ready missing or unavailable', async () => {
  const responses = [
    { ok: true, status: 200, json: async () => ({ ok: true, library: null }) },
    null,
  ];
  const client = createNodServiceClient({
    baseURL: 'http://127.0.0.1:3100',
    clientKey: 'test-client',
    storage: createStorage(),
    fetch: async () => {
      const response = responses.shift();
      if (!response) throw new Error('offline');
      return response;
    },
    logger: { warn() {} },
  });

  assert.deepEqual(
    await client.readDefaultLibraryResult({ accountId: 'rokid-1' }),
    { status: 'missing', library: null },
  );
  assert.deepEqual(
    await client.readDefaultLibraryResult({ accountId: 'rokid-1' }),
    { status: 'unavailable', library: null },
  );
});
