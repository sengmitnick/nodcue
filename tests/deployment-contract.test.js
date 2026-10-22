import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

test('ships the Dokploy and ACR deployment contract', async () => {
  for (const file of [
    'Dockerfile',
    'compose.production.yml',
    '.env.production.example',
    '.github/workflows/publish-nod-pronouncer.yml',
  ]) {
    assert.ok(await exists(file), `${file} is required`);
  }

  const compose = await readFile('compose.production.yml', 'utf8');
  const workflow = await readFile('.github/workflows/publish-nod-pronouncer.yml', 'utf8');
  assert.doesNotMatch(compose, /^\s{2}postgres:/m);
  assert.doesNotMatch(compose, /^\s+ports:/m);
  assert.match(compose, /^\s{2}migrate:/m);
  assert.match(compose, /^\s{2}web:/m);
  assert.match(compose, /dokploy-network:/);
  assert.match(
    workflow,
    /qinglion-registry\.cn-hangzhou\.cr\.aliyuncs\.com\/sengclaw\/nod/,
  );
});
