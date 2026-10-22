import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../src/pages/index/index.ink', import.meta.url);

test('keeps world awareness and gyroscope fallback for nods and shakes', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /enableWorldAwareness/);
  assert.match(source, /onHeadGesture/);
  assert.match(source, /new Gyroscope\(\{ frequency: 30 \}\)/);
  assert.match(source, /addEventListener\('reading'/);
  assert.match(source, /this\._gyroscope\.start\(\)/);
  assert.match(source, /this\._gyroscope\.stop\(\)/);
  assert.match(source, /detectNod/);
  assert.match(source, /detectShake/);
  assert.match(source, /this\._handleHeadGesture\(gesture, now\)/);
  assert.match(source, /_lastSensorGestureAt/);
  assert.doesNotMatch(source, /_lastSensorNodAt/);
  assert.doesNotMatch(source, /LanguageModel/);
  assert.doesNotMatch(source, /createCameraContext/);
});

test('keeps Web Speech and the working app wx TTS fallback', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /SpeechSynthesisUtterance/);
  assert.match(source, /speechSynthesis\.speak/);
  assert.match(source, /wx\.speech\.playTTS/);
});

test('uses semantic menu input while preserving closed-menu word navigation', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /actionFromKey/);
  assert.match(source, /action === 'PREVIOUS' \|\| action === 'NEXT'/);
  assert.match(source, /action === 'CONFIRM'/);
  assert.match(source, /action === 'BACK_OR_PAUSE'/);
  assert.match(source, /event && event\.preventDefault/);
  assert.match(source, /this\.moveWord\(action === 'PREVIOUS' \? -1 : 1\)/);
  assert.doesNotMatch(source, /const code = event && event\.code/);
  assert.doesNotMatch(source, /code === 'ArrowLeft'|code === 'ArrowRight'/);
  assert.doesNotMatch(source, /code === 'GlobalHook'/);
});

test('routes native and sensor gestures through one handler with shake debounce', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /_handleHeadGesture\(gesture, now = Date\.now\(\)\)/);
  assert.match(source, /this\._handleHeadGesture\(normalizeGesture\(event\)\)/);
  assert.match(source, /shouldAdvanceOnShake\(\{/);
  assert.match(source, /lastAdvancedAt: this\._lastShakeAt/);
  assert.match(source, /this\._lastShakeAt = now/);
  assert.match(source, /this\.moveWord\(1\)/);
});

test('opens a five-action menu and executes the focused action by stable ID', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /firstEnabledIndex\(ACTION_MENU_ITEMS\)/);
  assert.match(source, /moveFocus\(ACTION_MENU_ITEMS, this\.data\.menuIndex, delta\)/);
  assert.match(source, /selectedFocusItem\(ACTION_MENU_ITEMS, this\.data\.menuIndex\)/);
  assert.match(source, /case 'speak': this\.trySpeak\('nod', true\)/);
  assert.match(source, /case 'next-word': this\.moveWord\(1\)/);
  assert.match(source, /case 'refresh-library': await this\._refreshLibraryFromMenu\(\)/);
  assert.match(source, /case 'web-login': await this\._generatePairingCode\('manage'\)/);
  assert.match(source, /case 'exit': this\._exitApp\(\)/);
  assert.doesNotMatch(source, /if \(this\.data\.mode === 'ready'\) this\._generatePairingCode\('manage'\)/);
});

test('shows pairing success and waits for an explicit menu refresh', async () => {
  const source = await readFile(pageUrl, 'utf8');
  const polling = source.match(/async _pollPairingAndLibrary\(\) \{([\s\S]*?)\n  _startReady\(/);

  assert.ok(polling, 'pairing polling flow should exist');
  assert.match(polling[1], /status\.status === 'consumed'/);
  assert.match(polling[1], /this\._showPairingSuccess\(\)/);
  assert.doesNotMatch(polling[1], /this\._syncDefault\(\)/);
  assert.match(source, /setupTitle: '网页登录成功'/);
  assert.match(source, /setupDetail: '单击打开菜单，选择“刷新词库”'/);
});

test('refreshes the default library with explicit success and failure feedback', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /readDefaultLibraryResult/);
  assert.match(source, /result\.status === 'ready'/);
  assert.match(source, /网页端还没有默认词库/);
  assert.match(source, /刷新失败，请稍后重试/);
});

test('switches from the ready word layer to the pairing layer', async () => {
  const source = await readFile(pageUrl, 'utf8');
  const pairingFlow = source.match(
    /async _generatePairingCode\(purpose = 'setup'\) \{([\s\S]*?)\n  _pairingRemaining\(\)/,
  );

  assert.ok(pairingFlow, 'pairing flow should exist');
  assert.match(pairingFlow[1], /mode: 'loading'/);
  assert.match(pairingFlow[1], /modeBadge: 'PAIR'/);
  assert.match(pairingFlow[1], /setupTitle: '正在生成配对码'/);
  assert.match(pairingFlow[1], /mode: 'pairing'/);
  assert.match(pairingFlow[1], /webLoginURL:/);
  assert.doesNotMatch(
    pairingFlow[1],
    /\b(?:counterClass|wordStageClass|setupStageClass|hintClass|timerClass)\b/,
  );
});

test('pairs the current Rokid account and syncs only the default word library', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /createOpenAPI/);
  assert.match(source, /account\.getProfile/);
  assert.match(source, /ACCOUNT_RETRY_DELAYS_MS/);
  assert.match(source, /SERVICE_RETRY_DELAYS_MS/);
  assert.match(source, /OPEN_API_TIMEOUT_MS/);
  assert.match(source, /Promise\.race/);
  assert.match(source, /createPairingCode/);
  assert.match(source, /readPairingStatus/);
  assert.match(source, /readDefaultLibrary/);
  assert.match(source, /readCachedDefaultLibrary/);
  assert.match(source, /pairingCode/);
  assert.match(source, /libraryName/);
  assert.doesNotMatch(source, /\bWORDS\b|颁奖场景|文物场景|data\/words/);
});

test('shows a conditional countdown at the bottom of a ready session', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /countdownRemaining/);
  assert.match(source, /formatCountdown/);
  assert.match(source, /timerVisible/);
  assert.match(source, /timerText/);
  assert.match(source, /时间到/);
  assert.match(source, /mode === 'ready' && timerVisible/);
});

test('uses the Ink-compatible static data contract without legacy visibility classes', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /data:\s*\{/);
  assert.doesNotMatch(source, /data\s*\(\)\s*\{/);
  assert.match(source, /languageLabel/);
  for (const legacyField of [
    'counterClass',
    'wordStageClass',
    'meaningClass',
    'setupStageClass',
    'pairingCountdownClass',
    'webLoginURLClass',
    'hintClass',
    'timerClass',
    'menuClass',
    'menuArrow0Class',
    'menuIcon0Class',
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${legacyField}\\b`));
  }
  assert.doesNotMatch(source, /\{\{[^}]*[?][^}]*:[^}]*\}\}/);
});

test('uses native conditional rendering on the 480 by 352 glasses canvas', async () => {
  const source = await readFile(pageUrl, 'utf8');

  assert.doesNotMatch(source, /<view class="topline">/);
  assert.doesNotMatch(source, /<text class="counter"/);
  assert.match(source, /<text class="position" ink:if="\{\{mode === 'ready'\}\}">/);
  assert.match(source, /<view class="word-stage" ink:if="\{\{mode === 'ready'\}\}">/);
  assert.match(source, /<view class="setup-stage" ink:if="\{\{mode !== 'ready'\}\}">/);
  assert.match(source, /<text class="web-url" ink:if="\{\{mode === 'pairing'\}\}">/);
  assert.match(source, /<text class="pairing-countdown" ink:if="\{\{mode === 'pairing'\}\}">/);
  assert.match(source, /<view class="action-menu" ink:if="\{\{menuOpen\}\}">/);
  assert.match(source, /<text class="timer" ink:if="\{\{mode === 'ready' && timerVisible\}\}">/);
  assert.doesNotMatch(source, /\.hidden\s*\{/);
  assert.doesNotMatch(source, /['"][^'"\n]*\bhidden\b[^'"\n]*['"]/);
  assert.doesNotMatch(source, /ink:else/);

  const pageStyles = source.match(/\.page\s*\{([\s\S]*?)\n\}/);
  assert.ok(pageStyles, 'page styles should exist');
  assert.match(pageStyles[1], /width:\s*480px/);
  assert.match(pageStyles[1], /height:\s*352px/);
  assert.doesNotMatch(pageStyles[1], /100vw|100vh/);
});

test('uses a borderless lower-field HUD for word and setup content', async () => {
  const source = await readFile(pageUrl, 'utf8');

  assert.doesNotMatch(source, /<view class="topline">/);
  assert.match(source, /<text class="position" ink:if="\{\{mode === 'ready'\}\}">/);
  assert.match(source, /<view class="pairing-progress" ink:if="\{\{mode === 'pairing'\}\}">/);
  assert.match(source, /\.word-stage\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*58px/s);
  assert.match(source, /\.setup-stage\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*58px/s);
  assert.match(source, /\.word\s*\{[^}]*font-size:\s*52px/s);
  assert.doesNotMatch(source, /\.word-stage,\s*\.setup-stage\s*\{[^}]*border:/s);
  assert.doesNotMatch(source, /\.word-stage,\s*\.setup-stage\s*\{[^}]*border-radius:/s);
});

test('renders the approved menu order with icons and selected arrows', async () => {
  const source = await readFile(pageUrl, 'utf8');
  const menu = source.match(
    /<view class="action-menu" ink:if="\{\{menuOpen\}\}">([\s\S]*?)<\/view>\s*<view class="footer">/,
  );

  assert.ok(menu, 'action menu markup should exist before the footer');
  const labels = ['朗读词汇', '下个词汇', '刷新词库', '网页登录', '退出'];
  let previous = -1;
  for (const label of labels) {
    const position = menu[1].indexOf(label);
    assert.ok(position > previous, `${label} should appear in the approved order`);
    previous = position;
  }
  for (const icon of ['speak', 'next', 'refresh', 'login', 'exit']) {
    assert.match(menu[1], new RegExp(`/assets/icons/${icon}\\.svg`));
  }
  for (let index = 0; index < labels.length; index += 1) {
    assert.match(menu[1], new RegExp(`menuIndex === ${index}`));
    assert.match(menu[1], new RegExp(`menuIndex !== ${index}`));
  }
  assert.match(source, /\.action-menu\s*\{/);
  assert.match(source, /\.menu-text-active\s*\{/);
});
