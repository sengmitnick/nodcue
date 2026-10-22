import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = new URL('../', import.meta.url);
const srcRoot = new URL('../src/', import.meta.url);
const pageUrl = new URL('../src/pages/index/index.ink', import.meta.url);
const wordsUrl = new URL('../src/data/demo-words.js', import.meta.url);

async function walk(directoryUrl) {
  const directory = directoryUrl.pathname;
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(new URL(`file://${resolved}/`)));
    else files.push(resolved);
  }
  return files;
}

test('uses a distinct offline demo identity', async () => {
  const [agents, definition, appJson, page] = await Promise.all([
    readFile(new URL('src/AGENTS.md', projectRoot), 'utf8'),
    readFile(new URL('agent.json', projectRoot), 'utf8'),
    readFile(new URL('src/app.json', projectRoot), 'utf8'),
    readFile(pageUrl, 'utf8'),
  ]);
  const identity = `${agents}\n${definition}\n${appJson}\n${page}`;
  assert.match(identity, /演讲发音助手/);
  assert.doesNotMatch(identity, /不卡壳/);
});

test('contains a five-word local library and a ten-minute countdown', async () => {
  const [page, words] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(wordsUrl, 'utf8'),
  ]);
  assert.match(words, /countdownSeconds:\s*600/);
  assert.equal((words.match(/Object\.freeze\(\{ text:/g) || []).length, 5);
  assert.match(page, /DEMO_LIBRARY/);
  assert.match(page, /formatCountdown/);
});

test('contains no cloud, account, pairing, or old-product path', async () => {
  const files = await walk(srcRoot);
  const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  for (const forbidden of [
    /\bfetch\b/,
    /createOpenAPI/,
    /localStorage/,
    /pairing/i,
    /nod\.sengclaw\.com/,
    /clientKey/,
    /网页登录/,
    /刷新词库/,
    /不卡壳/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test('keeps the lower-field HUD and local device interactions', async () => {
  const page = await readFile(pageUrl, 'utf8');
  assert.match(page, /width:\s*480px/);
  assert.match(page, /height:\s*352px/);
  assert.match(page, /bottom:\s*58px/);
  assert.match(page, /enableWorldAwareness/);
  assert.match(page, /new Gyroscope\(\{ frequency: 30 \}\)/);
  assert.match(page, /onHeadGesture/);
  assert.match(page, /wx\.speech\.playTTS/);
  assert.match(page, /SpeechSynthesisUtterance/);
  assert.doesNotMatch(page, /<view class="setup-stage"/);
});
