import assert from 'node:assert/strict';
import test from 'node:test';

import { actionFromKey } from '../src/lib/input-actions.js';

test('maps only the final glasses swipe keys to semantic actions', () => {
  assert.equal(actionFromKey({ code: 'ArrowUp' }), 'PREVIOUS');
  assert.equal(actionFromKey({ code: 'ArrowDown' }), 'NEXT');
  assert.equal(actionFromKey({ code: 'Enter' }), 'CONFIRM');
  assert.equal(actionFromKey({ code: 'Backspace' }), 'BACK_OR_PAUSE');
  assert.equal(actionFromKey({ code: 'ArrowLeft' }), null);
  assert.equal(actionFromKey({ code: 'ArrowRight' }), null);
});

test('a physical swipe intermediate key plus its final key moves only once', () => {
  const backwardSwipe = ['ArrowLeft', 'ArrowLeft', 'ArrowUp']
    .map((code) => actionFromKey({ code }))
    .filter(Boolean);
  const forwardSwipe = ['ArrowRight', 'ArrowDown']
    .map((code) => actionFromKey({ code }))
    .filter(Boolean);

  assert.deepEqual(backwardSwipe, ['PREVIOUS']);
  assert.deepEqual(forwardSwipe, ['NEXT']);
});

test('does not let ambiguous runtime events trigger confirmation', () => {
  assert.equal(actionFromKey({ code: 'GlobalHook' }), null);
  assert.equal(actionFromKey({}), null);
  assert.equal(actionFromKey(), null);
});
