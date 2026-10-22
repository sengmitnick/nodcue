import assert from 'node:assert/strict';
import test from 'node:test';
import * as pronunciationSession from '../src/lib/pronunciation-session.js';

import {
  moveIndex,
  normalizeGesture,
  countdownRemaining,
  formatCountdown,
  pronunciationRequest,
  shouldSpeak,
} from '../src/lib/pronunciation-session.js';

test('detects the working app nod pattern without treating a shake as a nod', () => {
  assert.equal(typeof pronunciationSession.detectNod, 'function');
  assert.equal(pronunciationSession.detectNod([0, 1.7], [0, 0.2]), true);
  assert.equal(pronunciationSession.detectNod([0, 0.2], [0, 1.7]), false);
  assert.equal(pronunciationSession.detectNod([0, 1.2], [0, 0.1]), false);
});

test('detects a shake only when yaw movement is dominant and above threshold', () => {
  assert.equal(typeof pronunciationSession.detectShake, 'function');
  assert.equal(pronunciationSession.detectShake([0, 0.2], [0, 1.7]), true);
  assert.equal(pronunciationSession.detectShake([0, 1.7], [0, 0.2]), false);
  assert.equal(pronunciationSession.detectShake([0, 0.1], [0, 1.2]), false);
});

test('moves through the word list in a loop', () => {
  assert.equal(moveIndex(0, 1, 6), 1);
  assert.equal(moveIndex(5, 1, 6), 0);
  assert.equal(moveIndex(0, -1, 6), 5);
});

test('normalizes only supported nod gestures', () => {
  assert.equal(normalizeGesture({ gesture: 'NOD' }), 'nod');
  assert.equal(normalizeGesture({ gesture: 'shake' }), 'shake');
  assert.equal(normalizeGesture({}), 'unknown');
});

test('allows a nod only when idle and outside the cooldown', () => {
  assert.equal(shouldSpeak({ gesture: 'nod', speaking: false, now: 3000, lastSpokenAt: 1000 }), true);
  assert.equal(shouldSpeak({ gesture: 'nod', speaking: true, now: 3000, lastSpokenAt: 1000 }), false);
  assert.equal(shouldSpeak({ gesture: 'nod', speaking: false, now: 1800, lastSpokenAt: 1000 }), false);
  assert.equal(shouldSpeak({ gesture: 'shake', speaking: false, now: 3000, lastSpokenAt: 1000 }), false);
});

test('advances on a shake only when idle and outside the shared cooldown', () => {
  assert.equal(typeof pronunciationSession.shouldAdvanceOnShake, 'function');
  assert.equal(pronunciationSession.shouldAdvanceOnShake({
    gesture: 'shake', speaking: false, now: 3000, lastAdvancedAt: 1000,
  }), true);
  assert.equal(pronunciationSession.shouldAdvanceOnShake({
    gesture: 'shake', speaking: true, now: 3000, lastAdvancedAt: 1000,
  }), false);
  assert.equal(pronunciationSession.shouldAdvanceOnShake({
    gesture: 'shake', speaking: false, now: 2500, lastAdvancedAt: 1000,
  }), false);
  assert.equal(pronunciationSession.shouldAdvanceOnShake({
    gesture: 'nod', speaking: false, now: 3000, lastAdvancedAt: 1000,
  }), false);
});

test('builds multilingual slow-reading requests without forcing auto to English', () => {
  assert.deepEqual(pronunciationRequest({ text: '兵馬俑', language: 'zh-CN', rate: 0.72 }), {
    text: '兵馬俑',
    lang: 'zh-CN',
    rate: 0.72,
    pitch: 1,
    volume: 1,
  });
  assert.equal(pronunciationRequest({ text: 'provenance', language: 'auto' }).lang, '');
});

test('calculates and formats an optional session countdown', () => {
  assert.equal(countdownRemaining(300, 1_000, 61_000), 240);
  assert.equal(countdownRemaining(300, 1_000, 400_000), 0);
  assert.equal(formatCountdown(240), '04:00');
  assert.equal(formatCountdown(0), '00:00');
});
