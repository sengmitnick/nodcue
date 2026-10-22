export const ACTION_MENU_ITEMS = Object.freeze([
  Object.freeze({ id: 'speak', label: '朗读当前词', enabled: true }),
  Object.freeze({ id: 'next-word', label: '下一个词', enabled: true }),
  Object.freeze({ id: 'reset-timer', label: '重新计时', enabled: true }),
  Object.freeze({ id: 'exit', label: '退出', enabled: true }),
]);

export function actionMenuSelection(index) {
  const size = ACTION_MENU_ITEMS.length;
  const selected = ((Number(index) % size) + size) % size;
  const state = { menuIndex: selected };
  for (let item = 0; item < size; item += 1) {
    state[`menuText${item}Class`] = item === selected ? 'menu-text-active' : 'menu-text';
  }
  return state;
}
