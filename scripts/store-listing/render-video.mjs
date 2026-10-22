import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source) throw new Error('usage: node scripts/store-listing/render-video.mjs <source-mp4>');

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '../..');
const stagingDirectory = join(root, '.tmp', 'store-listing', 'video-captions');
const output = join(root, 'deliverables', 'store-listing', 'preview-video.mp4');

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}

function captionSVG(text) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <rect x="40" y="48" width="640" height="68" rx="34" fill="#07100a" fill-opacity="0.88" stroke="#70ff8a" stroke-opacity="0.62"/>
  <text x="360" y="92" text-anchor="middle" fill="#effff2" font-family="PingFang SC, -apple-system, sans-serif" font-size="28" font-weight="600">${text}</text>
</svg>`;
}

const captions = ['点头朗读 · 多语言词条', '左右摇头或镜腿切词', '点击镜腿 · 方向键选择'];
await mkdir(stagingDirectory, { recursive: true });
const captionFiles = [];
for (const [index, caption] of captions.entries()) {
  const svg = join(stagingDirectory, `caption-${index + 1}.svg`);
  const png = join(stagingDirectory, `caption-${index + 1}.png`);
  await writeFile(svg, captionSVG(caption));
  run('sips', ['-s', 'format', 'png', svg, '--out', png]);
  captionFiles.push(png);
}

const filter = [
  '[0:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p[base]',
  `[base][1:v]overlay=0:0:enable='between(t,0,9)'[caption-one]`,
  `[caption-one][2:v]overlay=0:0:enable='between(t,9,20)'[caption-two]`,
  `[caption-two][3:v]overlay=0:0:enable='between(t,20,28)'[video]`,
].join(';');

run('ffmpeg', [
  '-hide_banner', '-y', '-ss', '12', '-t', '28', '-i', source,
  '-loop', '1', '-framerate', '30', '-i', captionFiles[0],
  '-loop', '1', '-framerate', '30', '-i', captionFiles[1],
  '-loop', '1', '-framerate', '30', '-i', captionFiles[2],
  '-filter_complex', filter,
  '-map', '[video]', '-map', '0:a:0?', '-t', '28',
  '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart',
  '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'medium',
  '-b:v', '900k', '-maxrate', '1050k', '-bufsize', '1800k',
  '-c:a', 'aac', '-b:a', '64k', output,
]);
