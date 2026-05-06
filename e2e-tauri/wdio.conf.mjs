import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const tauriTargetDir = path.join(rootDir, 'src-tauri', 'target', 'debug');
const appBinaryName = process.platform === 'win32' ? 'openpet.exe' : 'openpet';
const appBinaryPath = path.join(tauriTargetDir, appBinaryName);
const tauriDriverBinary =
  process.env.TAURI_DRIVER ??
  path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver');
const tauriDriverArgs = process.env.TAURI_NATIVE_DRIVER
  ? ['--native-driver', process.env.TAURI_NATIVE_DRIVER]
  : [];

let tauriDriver;
let tauriDriverExitExpected = false;

export const config = {
  runner: 'local',
  host: '127.0.0.1',
  port: 4444,
  specs: [path.join(rootDir, 'e2e-tauri', 'specs', '**', '*.mjs')],
  maxInstances: 1,
  logLevel: process.env.WDIO_LOG_LEVEL ?? 'warn',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60_000,
  },

  onPrepare: () => {
    if (process.platform === 'darwin') {
      throw new Error('Tauri WebDriver desktop tests are supported on Windows and Linux only.');
    }

    if (process.env.OPENPET_SKIP_TAURI_BUILD === '1') {
      return;
    }

    const result = runPnpm(['tauri', 'build', '--debug', '--no-bundle']);

    if (result.status !== 0) {
      throw new Error(`Tauri debug build failed with exit code ${result.status ?? 'unknown'}.`);
    }
  },

  beforeSession: () => {
    tauriDriverExitExpected = false;
    tauriDriver = spawn(tauriDriverBinary, tauriDriverArgs, {
      cwd: rootDir,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    tauriDriver.on('error', (error) => {
      console.error('tauri-driver error:', error);
      process.exit(1);
    });

    tauriDriver.on('exit', (code) => {
      if (!tauriDriverExitExpected) {
        console.error('tauri-driver exited unexpectedly with code:', code);
        process.exit(1);
      }
    });
  },

  afterSession: () => {
    closeTauriDriver();
  },

  onComplete: () => {
    closeTauriDriver();
  },
};

function runPnpm(args) {
  if (process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  }

  return spawnSync('pnpm', args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function closeTauriDriver() {
  tauriDriverExitExpected = true;

  if (tauriDriver && !tauriDriver.killed) {
    tauriDriver.kill();
  }
}

function registerShutdownCleanup() {
  process.once('exit', () => {
    closeTauriDriver();
  });

  const exitAfterCleanup = (code) => {
    closeTauriDriver();
    process.exit(code);
  };

  process.once('SIGINT', () => exitAfterCleanup(130));
  process.once('SIGTERM', () => exitAfterCleanup(143));
  process.once('SIGHUP', () => exitAfterCleanup(129));

  if (process.platform === 'win32') {
    process.once('SIGBREAK', () => exitAfterCleanup(130));
  }
}

registerShutdownCleanup();
