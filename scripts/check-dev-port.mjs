#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { platform } from 'node:os';

const HOST = '127.0.0.1';
const PORT = 15373;
const DEV_URL = `http://${HOST}:${PORT}`;

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function formatOwner(owner) {
  if (!owner) {
    return '  Unable to identify the owning process.';
  }

  if (typeof owner === 'string') {
    return owner
      .split('\n')
      .filter(Boolean)
      .map((line) => `  ${line}`)
      .join('\n');
  }

  return [
    owner.pid ? `  pid: ${owner.pid}` : null,
    owner.process ? `  process: ${owner.process}` : null,
    owner.commandLine ? `  command: ${owner.commandLine}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function getWindowsPortOwner() {
  const command = [
    `$connection = Get-NetTCPConnection -LocalAddress '${HOST}' -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if ($connection) {',
    '  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue',
    '  [PSCustomObject]@{ pid = $connection.OwningProcess; process = $process.Name; commandLine = $process.CommandLine } | ConvertTo-Json -Compress',
    '}',
  ].join('; ');
  const output = run('powershell.exe', ['-NoProfile', '-Command', command]);

  if (!output) {
    return null;
  }

  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

function getUnixPortOwner() {
  return (
    run('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN']) ||
    run('ss', ['-ltnp', `sport = :${PORT}`]) ||
    null
  );
}

function getPortOwner() {
  return platform() === 'win32' ? getWindowsPortOwner() : getUnixPortOwner();
}

function checkPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen({ host: HOST, port: PORT, exclusive: true });
  });
}

const available = await checkPort();

if (available) {
  process.exit(0);
}

console.error(`Port ${PORT} is already in use on ${HOST}.`);
console.error(`Tauri devUrl is fixed to ${DEV_URL}, so pnpm dev cannot safely use a fallback Vite port.`);
console.error('Detected listener:');
console.error(formatOwner(getPortOwner()));
console.error('Next steps:');
console.error('- If this is an old dev server, stop it from the terminal where it was started, then rerun pnpm dev or pnpm tauri:dev.');
console.error('- For browser-only preview that may auto-pick a free port, run pnpm dev:browser.');
process.exit(1);
