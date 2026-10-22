import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../deliverables/store-listing/', import.meta.url);
const previewVideo = fileURLToPath(new URL('preview-video.mp4', root));
const videoVerifier = fileURLToPath(new URL('../scripts/store-listing/verify-video.mjs', import.meta.url));

function verifyVideo(file) {
  return spawnSync(process.execPath, [videoVerifier, file], { encoding: 'utf8' });
}

async function readPng(name) {
  const file = new URL(name, root);
  const [buffer, metadata] = await Promise.all([readFile(file), stat(file)]);
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    size: metadata.size,
  };
}

test('ships copy matching the current app contract', async () => {
  const copy = await readFile(new URL('listing-copy.md', root), 'utf8');
  assert.match(copy, /不卡壳助手/);
  assert.doesNotMatch(copy, /\u522b\u5361\u58f3/);
  assert.match(copy, /0\.2\.0/);
  assert.match(copy, /类别：学习/);
  assert.match(copy, /音频、网络/);
  assert.match(copy, /眼镜菜单主动刷新/);
  assert.doesNotMatch(copy, /自动同步/);
});

test('ships one icon and three upload-safe previews', async () => {
  const icon = await readPng('app-icon.png');
  assert.deepEqual([icon.width, icon.height], [1024, 1024]);
  assert.ok(icon.size < 5 * 1024 * 1024);

  for (const name of ['preview-01-nod.png', 'preview-02-library.png', 'preview-03-menu.png']) {
    const preview = await readPng(name);
    assert.deepEqual([preview.width, preview.height], [1536, 1024]);
    assert.ok(preview.size < 5 * 1024 * 1024);
  }
});

test('keeps preview rendering tied to the current HUD captures', async () => {
  const renderer = await readFile(new URL('../scripts/store-listing/render-previews.mjs', import.meta.url), 'utf8');
  assert.match(renderer, /2026-10-12-hud\.png/);
  assert.match(renderer, /2026-10-12-menu\.png/);
  assert.match(renderer, /web-library\.png/);
  assert.match(renderer, /const safeLibraryViewBox = '0 280 1462 744';/);
  assert.doesNotMatch(renderer, /glasses-ready\.png/);
  assert.doesNotMatch(renderer, /glasses-menu\.png/);
});

test('manual preview only displays finalized listing assets', async () => {
  const layout = await readFile(new URL('../scripts/store-listing/preview-layout.html', import.meta.url), 'utf8');
  assert.doesNotMatch(layout, /\.tmp\/store-listing/);
  assert.match(layout, /preview-01-nod\.png/);
  assert.match(layout, /preview-02-library\.png/);
  assert.match(layout, /preview-03-menu\.png/);
});

test('ships one upload-safe preview video and its inspection manifest', async () => {
  const [video, manifestText] = await Promise.all([
    stat(new URL('preview-video.mp4', root)),
    readFile(new URL('video-manifest.json', root), 'utf8'),
  ]);
  assert.ok(video.size > 0);
  assert.ok(video.size < 5 * 1024 * 1024);
  assert.deepEqual(JSON.parse(manifestText), {
    width: 720,
    height: 1280,
    videoCodec: 'h264',
    audioCodec: 'aac',
    maxDurationSeconds: 35,
    metadataRemoved: true,
  });
});

test('validates the actual preview video before it is uploaded', () => {
  const result = verifyVideo(previewVideo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.video, 'h264 720x1280');
  assert.equal(report.audio, 'aac');
  assert.ok(report.durationSeconds > 20 && report.durationSeconds <= 35);
});

test('rejects preview videos containing unapproved metadata', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nod-listing-video-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const markedVideo = join(directory, 'sensitive-title.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', previewVideo,
    '-map', '0', '-c', 'copy', '-metadata', 'title=Sensitive Owner Name', markedVideo,
  ]);

  const result = verifyVideo(markedVideo);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /metadata|tag/i);
});
