import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publicRoot = new URL('../server/public/', import.meta.url);

test('web app offers pairing login and a dynamic word library workspace', async () => {
  const html = await readFile(new URL('index.html', publicRoot), 'utf8');
  assert.match(html, /四位配对码/);
  assert.match(html, /登录词库工作台/);
  assert.match(html, /创建词库/);
  assert.match(html, /默认词库/);
  assert.match(html, /倒计时/);
  assert.match(html, /词条文本/);
  assert.match(html, /朗读语言/);
  assert.match(html, /自定义语言标签/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /内置场景|6 个单词|两组词/);
});

test('web client calls session-scoped library APIs and supports common languages', async () => {
  const source = await readFile(new URL('app.js', publicRoot), 'utf8');
  assert.match(source, /\/api\/auth\/pairing-code/);
  assert.match(source, /\/api\/libraries/);
  assert.match(source, /\/default/);
  assert.match(source, /\/words/);
  for (const language of ['auto', 'zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'es-ES']) {
    assert.match(source, new RegExp(language));
  }
  assert.match(source, /custom-language/);
  assert.match(source, /countdownSeconds/);
  assert.match(source, /请在眼镜菜单选择“刷新词库”/);
  assert.doesNotMatch(source, /眼镜会自动同步/);
});

test('web styles have responsive, accessible login and editor states', async () => {
  const styles = await readFile(new URL('styles.css', publicRoot), 'utf8');
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media\s*\(max-width:/);
  assert.match(styles, /\.workspace-grid/);
  assert.match(styles, /\.pairing-input/);
  assert.match(styles, /prefers-reduced-motion/);
});
