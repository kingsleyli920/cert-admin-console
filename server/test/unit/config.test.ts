import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('loadConfig', () => {
  it('uses code defaults when no env is set', () => {
    expect(loadConfig({})).toEqual({
      port: 3001,
      dbPath: path.join(repoRoot, 'server', 'data', 'app.db'),
      appEnv: 'development',
      bulkIssueDelayMs: 150,
    });
  });

  it('reads PORT, DB_PATH, APP_ENV and BULK_ISSUE_DELAY_MS from env', () => {
    const config = loadConfig({
      PORT: '4100',
      DB_PATH: '/tmp/custom.db',
      APP_ENV: 'test',
      BULK_ISSUE_DELAY_MS: '0',
    });
    expect(config).toEqual({
      port: 4100,
      dbPath: '/tmp/custom.db',
      appEnv: 'test',
      bulkIssueDelayMs: 0,
    });
  });

  it('resolves a relative DB_PATH from the repo root', () => {
    expect(loadConfig({ DB_PATH: 'test-results/x.db' }).dbPath).toBe(
      path.join(repoRoot, 'test-results', 'x.db'),
    );
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ PORT: '', BULK_ISSUE_DELAY_MS: '' })).toMatchObject({
      port: 3001,
      bulkIssueDelayMs: 150,
    });
  });

  it('rejects non-numeric or out-of-range numbers', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ BULK_ISSUE_DELAY_MS: '-1' })).toThrow(/BULK_ISSUE_DELAY_MS/);
  });
});
