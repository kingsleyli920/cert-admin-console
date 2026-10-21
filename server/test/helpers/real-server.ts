import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface RealServer {
  url: string;
  port: number;
  dbPath: string;
  stop(): Promise<void>;
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function waitForHealth(url: string, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early (code ${child.exitCode}):\n${output()}`);
    }
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not become healthy in time:\n${output()}`);
}

/** Starts the REAL server process on a free port with a temp DB and waits for /api/health. */
export async function startRealServer(env: Record<string, string> = {}): Promise<RealServer> {
  const port = await findFreePort();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cac-server-'));
  const dbPath = path.join(tmpDir, 'app.db');

  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      APP_ENV: 'test',
      BULK_ISSUE_DELAY_MS: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (chunk) => (log += chunk));
  child.stderr?.on('data', (chunk) => (log += chunk));

  const url = `http://127.0.0.1:${port}`;

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      if (!(await waitForExit(child, 5_000))) {
        child.kill('SIGKILL');
        await waitForExit(child, 5_000);
      }
    }
    await rm(tmpDir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(url, child, () => log);
  } catch (err) {
    await stop();
    throw err;
  }
  return { url, port, dbPath, stop };
}
