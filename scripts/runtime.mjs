import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const tools = {
  vite: 'vite/bin/vite.js',
  vitest: 'vitest/vitest.mjs',
  tsc: 'typescript/bin/tsc',
};

// Resolve the actual interpreter instead of passing a Windows py launcher or a
// shell command to subprocesses. Each executable/path remains a single argument.
export function findPython({ env = process.env, platform = process.platform, probe = spawnSync } = {}) {
  const override = env.ATLAS_PYTHON || env.PYTHON;
  const candidates = override ? [[override, []]] : platform === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [command, prefix] of candidates) {
    const result = probe(command, [...prefix, '-c',
      'import json, sqlite3, sys; print(json.dumps([sys.executable, list(sys.version_info[:2])]))'],
    { cwd: projectRoot, encoding: 'utf8', timeout: 10_000, windowsHide: true, env: { ...env, PYTHONUTF8: '1' } });
    if (result.error || result.status !== 0) continue;
    try {
      const [executable, version] = JSON.parse(result.stdout.trim());
      if (typeof executable === 'string' && executable && Array.isArray(version)
          && version[0] === 3 && version[1] >= 10) return executable;
    } catch { /* An OS app alias or unrelated command is not a Python runtime. */ }
  }
  throw new Error(override
    ? `Cannot use Python 3.10+ with SQLite at ${override}. Set ATLAS_PYTHON to a Python executable path (without command arguments).`
    : 'Python 3.10+ with SQLite is required. Install Python, reopen your terminal, or set ATLAS_PYTHON to its executable path.');
}

export function rtPythonPath({ env = process.env, platform = process.platform } = {}) {
  return resolve(projectRoot, env.RT_VENV || '.venv-sionna-rt',
    ...(platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
}

export function runtimeEnv(env = process.env) {
  const rtPython = env.SIONNA_RT_PYTHON || (existsSync(rtPythonPath({ env })) ? rtPythonPath({ env }) : undefined);
  return { ...env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1',
    ...(rtPython ? { SIONNA_RT_PYTHON: rtPython } : {}) };
}

export function spawnPython(args, options = {}) {
  return spawn(findPython({ env: options.env ?? process.env }), args,
    { cwd: projectRoot, ...options, env: runtimeEnv(options.env ?? process.env) });
}

export function toolArgs(tool, args = []) {
  if (!tools[tool]) throw new Error(`Unknown frontend tool: ${tool}`);
  const entry = join(projectRoot, 'node_modules', tools[tool]);
  if (!existsSync(entry)) throw new Error(`Frontend dependencies are missing. Run npm run setup first (${tool}).`);
  return [entry, ...args];
}

// Invoke the JavaScript entry directly. npm.cmd cannot be execFile/spawn'ed on
// Windows, and a shell would add quoting and process-tree cleanup problems.
export function spawnTool(tool, args = [], options = {}) {
  return spawn(process.execPath, toolArgs(tool, args), { cwd: projectRoot, ...options });
}

export function runToolSync(tool, args = [], options = {}) {
  return execFileSync(process.execPath, toolArgs(tool, args), { cwd: projectRoot, ...options });
}

export async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  // On Windows, killing the Node launcher does not deliver SIGTERM to it.
  // Stop its descendants too so the Python listener cannot outlive a test.
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
  await new Promise(resolveStop => {
    if (child.exitCode !== null || child.signalCode !== null) { resolveStop(); return; }
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => { clearTimeout(timer); resolveStop(); });
  });
}

export function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit',
      ...options, env: runtimeEnv(options.env ?? process.env) });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    const cleanup = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', (code, signal) => {
      cleanup();
      if (code === 0) resolveRun();
      else reject(Object.assign(new Error(`${command} exited with ${signal ?? code}`),
        { exitCode: code ?? (signal === 'SIGINT' ? 130 : 1) }));
    });
  });
}

export function serverArgs(args = [], env = process.env) {
  const explicitPort = env.PORT !== undefined || args.some(arg => arg === '--port' || arg.startsWith('--port='));
  const disableFallback = args.includes('--no-port-fallback') || env.AUTO_PORT === '0';
  const fallback = !disableFallback && (args.includes('--port-fallback') || env.AUTO_PORT === '1' || !explicitPort);
  return ['serve.py', '--host', env.HOST || '127.0.0.1', '--port', env.PORT || '8765',
    ...args.filter(arg => !['--port-fallback', '--no-port-fallback'].includes(arg)),
    ...(fallback ? ['--port-fallback'] : [])];
}
