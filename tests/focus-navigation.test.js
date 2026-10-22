import assert from 'node:assert/strict';
import test from 'node:test';

import {
  firstEnabledIndex,
  moveFocus,
  selectedFocusItem,
} from '../src/lib/focus-navigation.js';

const items = [
  { id: 'first', enabled: true },
  { id: 'disabled', enabled: false },
  { id: 'last', enabled: true },
];

test('wraps focus in both directions and skips disabled items', () => {
  assert.equal(moveFocus(items, 0, -1), 2);
  assert.equal(moveFocus(items, 0, 1), 2);
  assert.equal(moveFocus(items, 2, 1), 0);
});

test('finds the first enabled item and resolves the current selection', () => {
  assert.equal(firstEnabledIndex(items), 0);
  assert.equal(selectedFocusItem(items, 2)?.id, 'last');
  assert.equal(selectedFocusItem(items, -1), null);
  assert.equal(moveFocus([{ id: 'none', enabled: false }], 0, 1), -1);
});
