import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const file = process.argv[2];
assert.ok(file, 'usage: node scripts/store-listing/verify-video.mjs <file>');

const maxBytes = 5 * 1024 * 1024;
const approvedMetadata = {
  format: {
    major_brand: /^isom$/,
    minor_version: /^\d+$/,
    compatible_brands: /^isomiso2avc1mp41$/,
    encoder: /^Lavf\d+(?:\.\d+)+$/,
  },
  video: {
    language: /^und$/,
    handler_name: /^VideoHandler$/,
    encoder: /^Lavc\d+(?:\.\d+)+ libx264$/,
  },
  audio: {
    language: /^und$/,
    handler_name: /^SoundHandler$/,
  },
};

function assertApprovedMetadata(scope, tags) {
  const rules = approvedMetadata[scope];
  const received = Object.keys(tags || {}).sort();
  const expected = Object.keys(rules).sort();
  assert.deepEqual(received, expected, `unexpected ${scope} metadata tags: ${received.join(', ')}`);
  for (const [key, pattern] of Object.entries(rules)) {
    assert.match(String(tags[key]), pattern, `unexpected ${scope} metadata value for ${key}`);
  }
  return received.map((key) => `${scope}:${key}`);
}

const metadata = JSON.parse(execFileSync('ffprobe', [
  '-v', 'error',
  '-show_entries', 'format=duration,size:format_tags:stream=codec_type,codec_name,width,height,avg_frame_rate:stream_tags',
  '-of', 'json',
  file,
], { encoding: 'utf8' }));
const video = metadata.streams.find((stream) => stream.codec_type === 'video');
const audio = metadata.streams.find((stream) => stream.codec_type === 'audio');
const duration = Number(metadata.format.duration);

assert.ok(video, 'video stream is required');
assert.ok(audio, 'audio stream is required');
assert.equal(video.codec_name, 'h264');
assert.equal(video.width, 720);
assert.equal(video.height, 1280);
assert.equal(audio.codec_name, 'aac');
assert.ok(duration > 20 && duration <= 35, `duration must be 20–35 seconds, got ${duration}`);
assert.ok(statSync(file).size < maxBytes, 'video must be smaller than 5 MiB');
const tags = [
  ...assertApprovedMetadata('format', metadata.format.tags),
  ...assertApprovedMetadata('video', video.tags),
  ...assertApprovedMetadata('audio', audio.tags),
];

console.log(JSON.stringify({
  durationSeconds: Number(duration.toFixed(3)),
  bytes: statSync(file).size,
  video: `${video.codec_name} ${video.width}x${video.height}`,
  audio: audio.codec_name,
  metadataTags: tags,
}, null, 2));
