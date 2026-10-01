import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findPython, projectRoot, rtPythonPath, run, runtimeEnv, serverArgs, toolArgs } from './runtime.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
const integrationTests = ['test_frontend_proxy.test.mjs', 'test_frontend_build_server.test.mjs'];
const runTool = (tool, toolOptions = [], env = process.env) => run(process.execPath, toolArgs(tool, toolOptions), { env });

async function test() {
  const python = findPython();
  const files = readdirSync(projectRoot).filter(file => file.endsWith('.test.mjs') && !integrationTests.includes(file)).sort();
  await run(process.execPath, ['--test', ...files]);
  await run(python, ['-m', 'unittest', '-q', 'test_serve.py', 'test_rt_worker.py', 'test_storage.py']);
}

async function integration() {
  findPython();
  await runTool('vite', ['build']);
  await run(process.execPath, ['--test', ...integrationTests]);
}

async function main() {
  switch (command) {
    case 'start': {
      const python = findPython();
      await runTool('vite', ['build']);
      await run(python, serverArgs(args));
      break;
    }
    case 'api':
      await run(findPython(), serverArgs(args));
      break;
    case 'test':
      await test();
      break;
    case 'test:ui':
      await runTool('vitest', ['run', ...args], { ...process.env, NODE_ENV: 'test' });
      break;
    case 'test:integration':
      await integration();
      break;
    case 'check':
      await test();
      await runTool('tsc', ['--noEmit']);
      await runTool('vitest', ['run'], { ...process.env, NODE_ENV: 'test' });
      await integration();
      for (const directory of [projectRoot, join(projectRoot, 'scripts')]) {
        for (const file of readdirSync(directory).filter(file => file.endsWith('.mjs') && !file.endsWith('.test.mjs'))) {
          await run(process.execPath, ['--check', join(directory, file)]);
        }
      }
      break;
    case 'rt:setup': {
      const uv = process.env.UV || 'uv';
      await run(uv, ['venv', '--allow-existing', '--python', process.env.RT_PYTHON_VERSION || '3.13',
        process.env.RT_VENV || '.venv-sionna-rt']);
      await run(uv, ['pip', 'install', '--python', rtPythonPath(), `sionna-rt==${process.env.SIONNA_RT_VERSION || '2.1.0'}`]);
      break;
    }
    case 'test:rt': {
      const env = runtimeEnv();
      if (!env.SIONNA_RT_PYTHON || !existsSync(env.SIONNA_RT_PYTHON)) {
        throw new Error('Sionna-RT Python not found. Run npm run rt:setup or set SIONNA_RT_PYTHON to its executable path.');
      }
      await run(findPython(), ['-m', 'unittest', '-q', 'test_rt_integration.py'], { env });
      break;
    }
    case 'help':
      console.log(`Atlas RAN Twin (Windows, macOS, Linux)
  npm run setup            Install pinned frontend dependencies
  npm start                Build and serve the app and SQLite API
  npm start -- --port 8766  Require a specific port
  npm run api              Start only the Python API for npm run dev
  npm test                 Run JavaScript and Python tests
  npm run check            Run tests, type checks, build and integration checks
  npm run test:e2e         Run browser tests (install Chromium first)
  npm run rt:setup          Install the optional Sionna-RT runtime using uv
  npm run test:rt           Run a real local Sionna-RT job`);
      break;
    default:
      throw new Error(`Unknown command: ${command}. Run npm run help for available commands.`);
  }
}

try { await main(); }
catch (error) {
  console.error(error.message);
  process.exitCode = error.exitCode || 1;
}
