import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_MENU_ITEMS,
  ACTION_MENU_LABELS,
  actionMenuSelection,
} from '../src/lib/action-menu.js';

test('keeps stable IDs and the five approved glasses actions in order', () => {
  assert.deepEqual(ACTION_MENU_ITEMS.map((item) => item.id), [
    'speak',
    'next-word',
    'refresh-library',
    'web-login',
    'exit',
  ]);
  assert.deepEqual(ACTION_MENU_LABELS, [
    '朗读词汇',
    '下个词汇',
    '刷新词库',
    '网页登录',
    '退出',
  ]);
  assert.equal(ACTION_MENU_ITEMS.every((item) => item.enabled), true);
});

test('precomputes only text focus classes without hidden styles', () => {
  const state = actionMenuSelection(2);

  assert.deepEqual(Object.keys(state).sort(), [
    'menuIndex',
    'menuText0Class',
    'menuText1Class',
    'menuText2Class',
    'menuText3Class',
    'menuText4Class',
  ].sort());
  assert.equal(state.menuText2Class, 'menu-text-active');
  assert.equal(state.menuText1Class, 'menu-text');
  assert.doesNotMatch(JSON.stringify(state), /hidden/);
});
