export function moveFocus(items, currentIndex, delta) {
  if (!Array.isArray(items) || !items.some((item) => item.enabled !== false)) return -1;

  const length = items.length;
  let index = Number.isInteger(currentIndex) ? currentIndex : 0;
  for (let step = 0; step < length; step += 1) {
    index = (index + delta + length) % length;
    if (items[index].enabled !== false) return index;
  }
  return -1;
}

export function firstEnabledIndex(items) {
  return (items || []).findIndex((item) => item.enabled !== false);
}

export function selectedFocusItem(items, focusedIndex) {
  return focusedIndex >= 0 ? (items || [])[focusedIndex] || null : null;
}
