export function actionFromKey(event = {}) {
  const code = event.code || '';
  if (code === 'Enter') return 'CONFIRM';
  if (code === 'ArrowUp' || code === 'ArrowLeft') return 'PREVIOUS';
  if (code === 'ArrowDown' || code === 'ArrowRight') return 'NEXT';
  if (code === 'Backspace') return 'BACK_OR_PAUSE';
  return null;
}
