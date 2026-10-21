import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface Config {
  port: number;
  dbPath: string;
  appEnv: string;
  bulkIssueDelayMs: number;
}

type Env = Record<string, string | undefined>;

function readInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function readString(env: Env, name: string, fallback: string): string {
  const raw = env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/** Defaults live here; env only overrides them. */
export function loadConfig(env: Env = process.env): Config {
  const dbPath = readString(env, 'DB_PATH', path.join('server', 'data', 'app.db'));
  return {
    port: readInt(env, 'PORT', 3001, 1, 65535),
    dbPath: path.resolve(repoRoot, dbPath),
    appEnv: readString(env, 'APP_ENV', 'development'),
    bulkIssueDelayMs: readInt(env, 'BULK_ISSUE_DELAY_MS', 150, 0, 60_000),
  };
}
