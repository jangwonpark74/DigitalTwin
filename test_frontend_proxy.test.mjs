import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWorkspaceState } from './workspaces.mjs';
import { workspaceArtifactIndex } from './artifacts.mjs';
import { spawnPython, spawnTool } from './scripts/runtime.mjs';

const root = new URL('.', import.meta.url);

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForPreview(url, child, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited early (${child.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // A fresh local dev server can need a short moment to bind its port.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

function stop(child) {
  if (child.exitCode !== null) return Promise.resolve();
  child.kill('SIGTERM');
  return Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 3_000)),
  ]);
}

test('Vite proxies revisioned workspace saves and stale-revision conflicts to the existing API', async () => {
  const workspace = createWorkspaceState(undefined, {
    id: 'proxy-contract',
    now: '2026-09-30T00:00:00.000Z',
  });
  const artifacts = workspaceArtifactIndex(workspace);
  const payload = { revision: 0, workspace, artifacts };
  const databaseDirectory = await mkdtemp(join(tmpdir(), 'atlas-vite-proxy-'));
  const apiPort = await freePort();
  const vitePort = await freePort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const browserOrigin = `http://127.0.0.1:${vitePort}`;
  const api = spawnPython(['serve.py', '--host', '127.0.0.1', '--port', String(apiPort)], {
    cwd: new URL('.', import.meta.url),
    env: { ...process.env, ATLAS_DB_PATH: join(databaseDirectory, 'workspace.sqlite3') },
    stdio: 'ignore',
  });
  const vite = spawnTool('vite', ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    cwd: new URL('.', import.meta.url),
    env: { ...process.env, NODE_ENV: 'development', ATLAS_API_ORIGIN: apiOrigin },
    stdio: 'ignore',
  });

  try {
    await waitForPreview(`${browserOrigin}/frontend-preview.html`, vite, 'Vite');
    await waitForPreview(`${apiOrigin}/api/workspace`, api, 'Python API');

    const write = () => fetch(`${browserOrigin}/api/workspace`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: browserOrigin,
      },
      body: JSON.stringify(payload),
    });
    const saved = await write();
    assert.equal(saved.status, 200, 'the first revisioned save should pass the Python same-origin check');
    assert.deepEqual(await saved.json(), { revision: 1 });

    const stale = await write();
    assert.equal(stale.status, 409, 'a stale revision should remain a visible conflict through the proxy');
    assert.match((await stale.json()).error, /changed in another browser tab/i);
  } finally {
    await Promise.all([stop(vite), stop(api)]);
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
