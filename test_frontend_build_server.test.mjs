import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { stopProcess } from './scripts/runtime.mjs';

const root = new URL('.', import.meta.url);
const build = new URL('./dist/', import.meta.url);

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Python server exited early (${child.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Wait briefly while the loopback listener starts.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Python server did not serve ${url}`);
}

function getRawPath(port, path) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('the portable launcher builds and serves the React workspace with its Python API', async () => {
  const html = await readFile(new URL('index.html', build), 'utf8');
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/frontend-preview\/assets\/[^\"]+)"/g)].map(match => match[1]);
  assert.ok(assetPaths.some(path => path.endsWith('.js')), 'the built module entry should be linked');
  assert.ok(assetPaths.some(path => path.endsWith('.css')), 'the built stylesheet should be linked');
  assert.doesNotMatch(html, /cesium/i);

  const temporary = await mkdtemp(join(tmpdir(), 'atlas production 한글 '));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [fileURLToPath(new URL('scripts/atlas.mjs', root)),
    'start', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, ATLAS_DB_PATH: join(temporary, 'workspace.sqlite3') },
    stdio: 'ignore',
  });

  try {
    await waitForServer(`${origin}/`, server);

    const rootPage = await fetch(`${origin}/`);
    const rootHtml = await rootPage.text();
    assert.equal(rootPage.status, 200);
    assert.equal(rootPage.headers.get('cache-control'), 'no-store');
    assert.match(rootHtml, /<script[^>]+type="module"[^>]+src="\/frontend-preview\/assets\//);
    assert.match(rootHtml, /Digital Twin Studio/);

    const api = await fetch(`${origin}/api/workspace`);
    assert.equal(api.status, 200);
    assert.match(api.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await api.json(), { revision: 0, workspace: null });

    const preview = await fetch(`${origin}/frontend-preview.html`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('cache-control'), 'no-store');
    assert.equal(await preview.text(), rootHtml);

    for (const path of assetPaths) {
      const asset = await fetch(new URL(path, origin));
      assert.equal(asset.status, 200, path);
      assert.equal(asset.headers.get('cache-control'), 'no-store', path);
    }

    const traversal = await getRawPath(port, '/frontend-preview/assets/../../../README.md');
    assert.equal(traversal.status, 404);
    assert.doesNotMatch(traversal.body.toString('utf8'), /Atlas RAN Twin/);
  } finally {
    await stopProcess(server);
    await assert.rejects(fetch(`${origin}/api/workspace`), 'the launcher must also stop the Python listener');
    await rm(temporary, { recursive: true, force: true });
  }
});
