export function actionFromKey(event = {}) {
  const code = event.code || '';
  if (code === 'Enter') return 'CONFIRM';
  if (code === 'ArrowUp') return 'PREVIOUS';
  if (code === 'ArrowDown') return 'NEXT';
  if (code === 'Backspace') return 'BACK_OR_PAUSE';
  return null;
}
