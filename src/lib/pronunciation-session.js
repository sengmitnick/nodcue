export const SPEECH_COOLDOWN_MS = 1400;
export const SHAKE_COOLDOWN_MS = 2000;

export function moveIndex(index, delta, size) {
  return ((index + delta) % size + size) % size;
}

export function normalizeGesture(event) {
  const gesture = String(event?.gesture || '').trim().toLowerCase();
  return gesture === 'nod' || gesture === 'shake' ? gesture : 'unknown';
}

export function detectNod(
  pitchHistory,
  yawHistory,
  { threshold = 1.5, directionRatio = 1.2 } = {},
) {
  if (!pitchHistory?.length || !yawHistory?.length) return false;
  const pitchDiff = Math.max(...pitchHistory) - Math.min(...pitchHistory);
  const yawDiff = Math.max(...yawHistory) - Math.min(...yawHistory);
  return pitchDiff > threshold && pitchDiff > yawDiff * directionRatio;
}

export function detectShake(
  pitchHistory,
  yawHistory,
  { threshold = 1.5, directionRatio = 1.2 } = {},
) {
  if (!pitchHistory?.length || !yawHistory?.length) return false;
  const pitchDiff = Math.max(...pitchHistory) - Math.min(...pitchHistory);
  const yawDiff = Math.max(...yawHistory) - Math.min(...yawHistory);
  return yawDiff > threshold && yawDiff > pitchDiff * directionRatio;
}

export function shouldSpeak({
  gesture,
  speaking,
  now,
  lastSpokenAt,
  cooldownMs = SPEECH_COOLDOWN_MS,
}) {
  return gesture === 'nod' && !speaking && now - lastSpokenAt >= cooldownMs;
}

export function shouldAdvanceOnShake({
  gesture,
  speaking,
  now,
  lastAdvancedAt,
  cooldownMs = SHAKE_COOLDOWN_MS,
}) {
  return gesture === 'shake' && !speaking && now - lastAdvancedAt >= cooldownMs;
}

export function pronunciationRequest(word) {
  const rate = Number(word?.rate);
  return {
    text: String(word?.text || ''),
    lang: word?.language && word.language !== 'auto' ? String(word.language) : '',
    rate: rate > 0 ? rate : 0.72,
    pitch: 1,
    volume: 1,
  };
}

export function countdownRemaining(durationSeconds, startedAt, now) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const elapsed = Math.max(0, Math.floor((Number(now) - Number(startedAt)) / 1000));
  return Math.max(0, Math.ceil(duration - elapsed));
}

export function formatCountdown(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
