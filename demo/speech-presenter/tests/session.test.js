import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTION_MENU_ITEMS } from '../src/lib/action-menu.js';
import { actionFromKey } from '../src/lib/input-actions.js';
import {
  moveIndex,
  shouldAdvanceOnShake,
  shouldSpeak,
} from '../src/lib/pronunciation-session.js';

test('maps glasses keys to local semantic actions', () => {
  assert.equal(actionFromKey({ code: 'ArrowUp' }), 'PREVIOUS');
  assert.equal(actionFromKey({ code: 'ArrowLeft' }), 'PREVIOUS');
  assert.equal(actionFromKey({ code: 'ArrowDown' }), 'NEXT');
  assert.equal(actionFromKey({ code: 'ArrowRight' }), 'NEXT');
  assert.equal(actionFromKey({ code: 'Enter' }), 'CONFIRM');
  assert.equal(actionFromKey({ code: 'Backspace' }), 'BACK_OR_PAUSE');
});

test('offers only four local menu actions', () => {
  assert.deepEqual(ACTION_MENU_ITEMS.map((item) => item.id), [
    'speak',
    'next-word',
    'reset-timer',
    'exit',
  ]);
});

test('keeps nod and shake cooldowns and loops through five words', () => {
  assert.equal(shouldSpeak({
    gesture: 'nod', speaking: false, now: 3000, lastSpokenAt: 1000,
  }), true);
  assert.equal(shouldAdvanceOnShake({
    gesture: 'shake', speaking: false, now: 3000, lastAdvancedAt: 1000,
  }), true);
  assert.equal(moveIndex(4, 1, 5), 0);
  assert.equal(moveIndex(0, -1, 5), 4);
});
