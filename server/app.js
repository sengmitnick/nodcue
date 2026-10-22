import { randomInt as secureRandomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { formatPairingCode, PAIRING_TTL_MS } from './domain.js';
import {
  createSessionToken,
  hashPairingCode,
  readSessionToken,
  safeEqual,
} from './security.js';

const COOKIE_NAME = 'nod_session';
const MAX_BODY_BYTES = 64 * 1024;

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function statusFor(error) {
  if (Number.isInteger(error?.status)) return error.status;
  if (error?.message === 'empty_library') return 409;
  if (/_(?:not_found)$/.test(error?.message || '')) return 404;
  if (/^(?:invalid_|account_required|store_file_required)/.test(error?.message || '')) return 400;
  return 500;
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw apiError('body_too_large', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    throw apiError('invalid_json');
  }
}

function readCookie(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  for (const entry of cookies) {
    const [key, ...parts] = entry.trim().split('=');
    if (key === name) return parts.join('=');
  }
  return '';
}

function publicUser(user) {
  return {
    id: user.id,
    accountName: user.accountName || 'Rokid 用户',
    defaultLibraryId: user.defaultLibraryId || null,
  };
}

function publicLibrary(library) {
  if (!library) return null;
  return {
    id: library.id,
    name: library.name,
    countdownSeconds: library.countdownSeconds,
    updatedAt: library.updatedAt,
    words: library.words.map((word) => ({
      id: word.id,
      text: word.text,
      hint: word.hint,
      language: word.language,
      rate: word.rate,
    })),
  };
}

function sourceAddress(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || request.socket.remoteAddress || 'unknown';
}

export function createApp({
  store,
  clientKey,
  sessionSecret,
  publicDir,
  secureCookies = false,
  now = Date.now,
  randomInt = secureRandomInt,
}) {
  const exchangeFailures = new Map();
  const secureCookieSuffix = secureCookies ? '; Secure' : '';

  function requireClient(request) {
    const supplied = request.headers['x-nod-client-key'];
    if (!supplied || !safeEqual(supplied, clientKey)) throw apiError('unauthorized_client', 401);
  }

  async function requireUser(request) {
    const token = readCookie(request, COOKIE_NAME);
    const session = readSessionToken(token, sessionSecret, now());
    if (!session) throw apiError('authentication_required', 401);
    const user = await store.getUserById(session.userId);
    if (!user) throw apiError('authentication_required', 401);
    return user;
  }

  function canAttemptExchange(request) {
    const key = sourceAddress(request);
    const threshold = now() - 10 * 60 * 1000;
    const attempts = (exchangeFailures.get(key) || []).filter((time) => time > threshold);
    exchangeFailures.set(key, attempts);
    return attempts.length < 5;
  }

  function recordExchangeFailure(request) {
    const key = sourceAddress(request);
    const attempts = exchangeFailures.get(key) || [];
    attempts.push(now());
    exchangeFailures.set(key, attempts);
  }

  async function handleApi(request, response, url) {
    const pathname = url.pathname;

    if (request.method === 'POST' && pathname === '/api/v1/pairing-codes') {
      requireClient(request);
      const body = await readJson(request);
      const user = await store.upsertUser(body);
      let pairing = null;
      let code = '';
      for (let attempt = 0; attempt < 20; attempt += 1) {
        code = formatPairingCode(randomInt(0, 10_000));
        try {
          pairing = await store.createPairing({
            userId: user.id,
            codeHash: hashPairingCode(code, sessionSecret),
            expiresAt: now() + PAIRING_TTL_MS,
          });
          break;
        } catch (error) {
          if (error.message !== 'pairing_collision') throw error;
        }
      }
      if (!pairing) throw apiError('pairing_unavailable', 503);
      sendJson(response, 200, {
        ok: true,
        publicId: pairing.id,
        code,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
      });
      return true;
    }

    const pairingStatus = pathname.match(/^\/api\/v1\/pairing-codes\/([^/]+)\/status$/);
    if (request.method === 'POST' && pairingStatus) {
      requireClient(request);
      const body = await readJson(request);
      const user = await store.getUserByAccount(String(body.accountId || ''));
      if (!user) throw apiError('pairing_not_found', 404);
      const pairing = await store.readPairing({ id: decodeURIComponent(pairingStatus[1]), userId: user.id });
      if (!pairing) throw apiError('pairing_not_found', 404);
      sendJson(response, 200, {
        ok: true,
        status: pairing.status,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
      });
      return true;
    }

    if (request.method === 'POST' && pathname === '/api/auth/pairing-code') {
      if (!canAttemptExchange(request)) throw apiError('rate_limited', 429);
      const body = await readJson(request);
      const code = String(body.code || '');
      if (!/^\d{4}$/.test(code)) throw apiError('invalid_pairing_code', 401);
      const pairing = await store.consumePairing({ codeHash: hashPairingCode(code, sessionSecret) });
      if (!pairing) {
        recordExchangeFailure(request);
        throw apiError('invalid_pairing_code', 401);
      }
      const token = createSessionToken(pairing.userId, sessionSecret, now());
      sendJson(response, 200, { ok: true }, {
        'set-cookie': `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureCookieSuffix}`,
      });
      return true;
    }

    if (request.method === 'GET' && pathname === '/api/me') {
      const user = await requireUser(request);
      sendJson(response, 200, { ok: true, user: publicUser(user) });
      return true;
    }

    if (request.method === 'POST' && pathname === '/api/logout') {
      sendJson(response, 200, { ok: true }, {
        'set-cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookieSuffix}`,
      });
      return true;
    }

    if (request.method === 'GET' && pathname === '/api/libraries') {
      const user = await requireUser(request);
      const libraries = await store.listLibraries(user.id);
      sendJson(response, 200, {
        ok: true,
        defaultLibraryId: user.defaultLibraryId || null,
        libraries: libraries.map(publicLibrary),
      });
      return true;
    }

    if (request.method === 'POST' && pathname === '/api/libraries') {
      const user = await requireUser(request);
      const library = await store.createLibrary(user.id, await readJson(request));
      sendJson(response, 201, { ok: true, library: publicLibrary(library) });
      return true;
    }

    const libraryRoute = pathname.match(/^\/api\/libraries\/([^/]+)$/);
    if (libraryRoute && request.method === 'PATCH') {
      const user = await requireUser(request);
      const library = await store.updateLibrary(user.id, decodeURIComponent(libraryRoute[1]), await readJson(request));
      sendJson(response, 200, { ok: true, library: publicLibrary(library) });
      return true;
    }
    if (libraryRoute && request.method === 'DELETE') {
      const user = await requireUser(request);
      await store.deleteLibrary(user.id, decodeURIComponent(libraryRoute[1]));
      sendJson(response, 200, { ok: true });
      return true;
    }

    const wordsRoute = pathname.match(/^\/api\/libraries\/([^/]+)\/words$/);
    if (wordsRoute && request.method === 'POST') {
      const user = await requireUser(request);
      const word = await store.addWord(user.id, decodeURIComponent(wordsRoute[1]), await readJson(request));
      sendJson(response, 201, { ok: true, word });
      return true;
    }

    const wordRoute = pathname.match(/^\/api\/libraries\/([^/]+)\/words\/([^/]+)$/);
    if (wordRoute && request.method === 'DELETE') {
      const user = await requireUser(request);
      await store.deleteWord(user.id, decodeURIComponent(wordRoute[1]), decodeURIComponent(wordRoute[2]));
      sendJson(response, 200, { ok: true });
      return true;
    }

    const defaultRoute = pathname.match(/^\/api\/libraries\/([^/]+)\/default$/);
    if (defaultRoute && request.method === 'POST') {
      const user = await requireUser(request);
      const library = await store.setDefaultLibrary(user.id, decodeURIComponent(defaultRoute[1]));
      sendJson(response, 200, { ok: true, library: publicLibrary(library) });
      return true;
    }

    if (request.method === 'POST' && pathname === '/api/v1/default-library') {
      requireClient(request);
      const body = await readJson(request);
      const accountId = String(body.accountId || '').trim();
      if (!accountId) throw apiError('account_required');
      const library = await store.getDefaultLibraryByAccount(accountId);
      sendJson(response, 200, { ok: true, library: publicLibrary(library) });
      return true;
    }

    return false;
  }

  async function serveStatic(response, url) {
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const resolved = path.resolve(publicDir, relative);
    if (!resolved.startsWith(`${path.resolve(publicDir)}${path.sep}`)) return false;
    try {
      const body = await readFile(resolved);
      response.writeHead(200, {
        'content-type': CONTENT_TYPES.get(path.extname(resolved)) || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      response.end(body);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  return async function app(request, response) {
    const url = new URL(request.url || '/', 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/healthz') {
        await store.health();
        sendJson(response, 200, { ok: true });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (!await handleApi(request, response, url)) sendJson(response, 404, { ok: false, error: 'not_found' });
        return;
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && await serveStatic(response, url)) return;
      sendJson(response, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      const status = statusFor(error);
      sendJson(response, status, {
        ok: false,
        error: status === 500 ? 'internal_error' : error.message,
      });
    }
  };
}
