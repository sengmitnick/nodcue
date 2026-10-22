const CACHE_KEY = 'nodDefaultLibrary';
const REQUEST_TIMEOUT_MS = 10_000;

function normalizeBaseURL(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeLibrary(value) {
  if (!value || !value.id || !value.name || !Array.isArray(value.words) || value.words.length === 0) {
    return null;
  }
  const words = value.words.map((word) => ({
    id: String(word.id || ''),
    text: String(word.text || '').trim(),
    hint: String(word.hint || '').trim(),
    language: String(word.language || 'auto').trim() || 'auto',
    rate: Number(word.rate) > 0 ? Number(word.rate) : 0.72,
  }));
  if (words.some((word) => !word.text)) return null;
  const library = {
    id: String(value.id),
    name: String(value.name),
    countdownSeconds: Number.isInteger(value.countdownSeconds) && value.countdownSeconds > 0
      ? value.countdownSeconds
      : null,
    words,
  };
  if (value.updatedAt) library.updatedAt = String(value.updatedAt);
  return library;
}

export function createNodServiceClient(options = {}) {
  const baseURL = normalizeBaseURL(options.baseURL);
  const clientKey = String(options.clientKey || '');
  const fetchImpl = options.fetch || fetch;
  const storage = options.storage || localStorage;
  const logger = options.logger || console;

  async function requestResult(path, body) {
    if (!baseURL || !clientKey) return { ok: false, data: null };
    let timeoutId = null;
    let controller = null;
    try {
      if (typeof AbortController !== 'undefined') controller = new AbortController();
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (controller) controller.abort();
          reject(new Error('timeout'));
        }, REQUEST_TIMEOUT_MS);
      });
      const response = await Promise.race([
        fetchImpl(`${baseURL}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-nod-client-key': clientKey,
          },
          body: JSON.stringify(body),
          signal: controller ? controller.signal : undefined,
        }),
        timeout,
      ]);
      if (!response || !response.ok) return { ok: false, data: null };
      return { ok: true, data: await response.json() };
    } catch (error) {
      try {
        logger.warn('[nod-service] request unavailable', error?.name === 'AbortError' ? 'timeout' : 'network');
      } catch (_) {}
      return { ok: false, data: null };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function request(path, body) {
    const result = await requestResult(path, body);
    return result.ok ? result.data : null;
  }

  async function createPairingCode(input) {
    if (!input?.accountId) return null;
    const data = await request('/api/v1/pairing-codes', {
      accountId: String(input.accountId),
      accountName: String(input.accountName || ''),
    });
    if (!data || !/^\d{4}$/.test(String(data.code || '')) || !data.publicId || !data.expiresAt) return null;
    return {
      publicId: String(data.publicId),
      code: String(data.code),
      expiresAt: String(data.expiresAt),
    };
  }

  async function readPairingStatus(input) {
    if (!input?.accountId || !input?.publicId) return null;
    const data = await request(`/api/v1/pairing-codes/${encodeURIComponent(String(input.publicId))}/status`, {
      accountId: String(input.accountId),
    });
    if (!data?.status) return null;
    return {
      status: String(data.status),
      expiresAt: String(data.expiresAt || ''),
    };
  }

  async function readDefaultLibraryResult(input) {
    if (!input?.accountId) return { status: 'unavailable', library: null };
    const result = await requestResult('/api/v1/default-library', {
      accountId: String(input.accountId),
    });
    if (!result.ok) return { status: 'unavailable', library: null };
    if (!result.data?.library) return { status: 'missing', library: null };
    const library = normalizeLibrary(result.data.library);
    if (!library) return { status: 'unavailable', library: null };
    try {
      storage.setItem(CACHE_KEY, JSON.stringify({
        accountId: String(input.accountId),
        library,
      }));
    } catch (_) {}
    return { status: 'ready', library };
  }

  async function readDefaultLibrary(input) {
    const result = await readDefaultLibraryResult(input);
    return result.library;
  }

  function readCachedDefaultLibrary(input) {
    if (!input?.accountId) return null;
    try {
      const cached = JSON.parse(storage.getItem(CACHE_KEY) || 'null');
      if (!cached || String(cached.accountId || '') !== String(input.accountId)) return null;
      return normalizeLibrary(cached.library);
    } catch (_) {
      return null;
    }
  }

  return {
    createPairingCode,
    readPairingStatus,
    readDefaultLibrary,
    readDefaultLibraryResult,
    readCachedDefaultLibrary,
  };
}
