export const PAIRING_TTL_MS = 30_000;

export function formatPairingCode(value) {
  return String(value).padStart(4, '0').slice(-4);
}

export function normalizeCountdownSeconds(value) {
  if (value === '' || value === null || value === undefined || value === false) return null;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 14_400) {
    throw new Error('invalid_countdown');
  }
  return seconds;
}

export function normalizeLibrary(input) {
  const name = String(input?.name || '').trim();
  if (!name || name.length > 60) throw new Error('invalid_library_name');
  return {
    name,
    countdownSeconds: normalizeCountdownSeconds(input?.countdownSeconds),
  };
}

export function normalizeWord(input) {
  const text = String(input?.text || '').trim();
  if (!text || text.length > 120) throw new Error('invalid_word_text');
  const language = String(input?.language || 'auto').trim();
  if (language !== 'auto' && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) {
    throw new Error('invalid_language');
  }
  return {
    text,
    hint: String(input?.hint || '').trim().slice(0, 120),
    language,
    rate: 0.72,
  };
}

export function assertDefaultable(library) {
  if (!library || !Array.isArray(library.words) || library.words.length === 0) {
    throw new Error('empty_library');
  }
  return library;
}
