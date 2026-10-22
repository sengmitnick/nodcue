import { createHmac, timingSafeEqual } from 'node:crypto';

function hmac(value, secret) {
  return createHmac('sha256', String(secret)).update(String(value)).digest('hex');
}

export function hashPairingCode(code, secret) {
  return hmac(`pairing:${code}`, secret);
}

export function safeEqual(first, second) {
  const left = Buffer.from(String(first));
  const right = Buffer.from(String(second));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSessionToken(userId, secret, now = Date.now(), ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({
    userId: String(userId),
    expiresAt: now + ttlMs,
  })).toString('base64url');
  return `${payload}.${hmac(`session:${payload}`, secret)}`;
}

export function readSessionToken(token, secret, now = Date.now()) {
  try {
    const [payload, signature, extra] = String(token || '').split('.');
    if (!payload || !signature || extra) return null;
    const expected = hmac(`session:${payload}`, secret);
    if (!safeEqual(signature, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.userId || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt < now) return null;
    return { userId: String(parsed.userId), expiresAt: Number(parsed.expiresAt) };
  } catch (_) {
    return null;
  }
}
