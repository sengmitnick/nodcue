export const ACTION_MENU_ITEMS = Object.freeze([
  Object.freeze({ id: 'speak', label: '朗读词汇', enabled: true }),
  Object.freeze({ id: 'next-word', label: '下个词汇', enabled: true }),
  Object.freeze({ id: 'refresh-library', label: '刷新词库', enabled: true }),
  Object.freeze({ id: 'web-login', label: '网页登录', enabled: true }),
  Object.freeze({ id: 'exit', label: '退出', enabled: true }),
]);

export const ACTION_MENU_LABELS = Object.freeze(
  ACTION_MENU_ITEMS.map((item) => item.label),
);

export function actionMenuSelection(index) {
  const size = ACTION_MENU_ITEMS.length;
  const selected = ((Number(index) % size) + size) % size;
  const state = { menuIndex: selected };
  for (let item = 0; item < size; item += 1) {
    const active = item === selected;
    state[`menuText${item}Class`] = active ? 'menu-text-active' : 'menu-text';
  }
  return state;
}
