import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the production root mounts React and keeps the activity preview fixture separate', async () => {
  const html = await read('./index.html');
  assert.match(html, /<div id="react-preview-root"><\/div>/);
  assert.match(html, /<script type="module" src="\/src\/main\.tsx"><\/script>/);
  assert.doesNotMatch(html, /app\.mjs/);

  const preview = await read('./frontend-preview.html');
  assert.match(preview, /data-preview-route="activity"/);
});

test('the open map stack does not install the removed globe library', async () => {
  const manifest = JSON.parse(await read('./package.json'));
  assert.equal(manifest.dependencies?.['maplibre-gl'], '5.23.0');
  assert.equal(manifest.dependencies?.cesium, undefined);
  assert.equal(manifest.devDependencies?.['vite-plugin-cesium'], undefined);
});
