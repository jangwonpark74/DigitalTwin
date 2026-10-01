import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { findPython, rtPythonPath, serverArgs, spawnPython } from './scripts/runtime.mjs';

test('Windows Python launcher resolves to an executable path without losing spaces or Unicode', () => {
  const executable = 'C:\\Users\\한글 User\\Python313\\python.exe';
  const calls = [];
  const python = findPython({ env: {}, platform: 'win32', probe(command, args, options) {
    calls.push([command, args]);
    assert.equal(options.shell, undefined);
    assert.equal(options.env.PYTHONUTF8, '1');
    return { status: 0, stdout: JSON.stringify([executable, [3, 13]]) };
  } });
  assert.equal(python, executable);
  assert.equal(calls[0][0], 'py');
  assert.deepEqual(calls[0][1].slice(0, 2), ['-3', '-c']);
});

test('Windows discovery skips app aliases and incompatible Python installations', () => {
  const commands = [];
  const python = findPython({ env: {}, platform: 'win32', probe(command) {
    commands.push(command);
    return command === 'py' ? { status: 1, stdout: '' }
      : command === 'python' ? { status: 0, stdout: 'Install Python from the Store' }
        : { status: 0, stdout: JSON.stringify(['C:\\Python313\\python.exe', [3, 13]]) };
  } });
  assert.equal(python, 'C:\\Python313\\python.exe');
  assert.deepEqual(commands, ['py', 'python', 'python3']);
  assert.throws(() => findPython({ env: {}, platform: 'win32', probe: () => ({
    status: 0, stdout: JSON.stringify(['python.exe', [3, 9]]),
  }) }), /Python 3\.10\+/);
});

test('an explicit Python override fails visibly instead of selecting a different runtime', () => {
  const commands = [];
  assert.throws(() => findPython({ env: { ATLAS_PYTHON: 'C:\\Python Files\\missing.exe' },
    platform: 'win32', probe(command) { commands.push(command); return { status: 1 }; },
  }), /Cannot use Python.*missing\.exe/);
  assert.deepEqual(commands, ['C:\\Python Files\\missing.exe']);
});

test('Sionna environments use the native Windows and Unix interpreter layouts', () => {
  assert.ok(rtPythonPath({ env: {}, platform: 'win32' }).endsWith(join('.venv-sionna-rt', 'Scripts', 'python.exe')));
  assert.ok(rtPythonPath({ env: {}, platform: 'darwin' }).endsWith(join('.venv-sionna-rt', 'bin', 'python')));
  assert.ok(rtPythonPath({ env: { RT_VENV: 'RT env' }, platform: 'win32' }).endsWith(join('RT env', 'Scripts', 'python.exe')));
});

test('portable startup keeps fallback opt-in for explicitly requested ports', () => {
  assert.ok(serverArgs([], {}).includes('--port-fallback'));
  for (const [args, env] of [[['--port', '8766'], {}], [['--port=8766'], {}],
    [[], { PORT: '8766' }], [[], { AUTO_PORT: '0' }], [['--no-port-fallback'], {}]]) {
    assert.ok(!serverArgs(args, env).includes('--port-fallback'));
  }
  assert.ok(serverArgs(['--port', '8766'], { AUTO_PORT: '1' }).includes('--port-fallback'));
  assert.ok(serverArgs(['--port', '8766', '--port-fallback'], {}).includes('--port-fallback'));
  assert.ok(!serverArgs(['--port-fallback', '--no-port-fallback'], {}).includes('--port-fallback'));
});

test('Python subprocess arguments and SQLite paths round-trip spaces, shell characters and Unicode', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'atlas runtime 한글 '));
  try {
    const database = join(temporary, 'workspace & data.sqlite3');
    const child = spawnPython(['-c',
      'import sqlite3, sys; c = sqlite3.connect(sys.argv[1]); c.execute("CREATE TABLE sample (name TEXT)"); c.execute("INSERT INTO sample VALUES (?)", (sys.argv[2],)); c.commit(); print(c.execute("SELECT name FROM sample").fetchone()[0]); c.close()',
      database, '서울 & Windows 11'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', data => { stdout += data; });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', data => { stderr += data; });
    const [code] = await once(child, 'close');
    assert.equal(code, 0, stderr);
    assert.equal(stdout.trim(), '서울 & Windows 11');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
