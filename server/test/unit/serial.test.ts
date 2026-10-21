import { describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../src/db/seed';
import { inTransaction } from '../../src/db/tx';
import { allocateSerial, formatSerial } from '../../src/modules/bulk-issue/serial';
import { createTestDb } from '../helpers/db';

const HHT = { id: SEED_IDS.tenants.hht, code: 'HHT', timezone: 'Australia/Sydney' };
const SRA = { id: SEED_IDS.tenants.sra, code: 'SRA', timezone: 'Australia/Perth' };
const nextSerial = (db: ReturnType<typeof createTestDb>, id: number) =>
  (db.prepare('SELECT next_serial AS n FROM tenants WHERE id = ?').get(id) as { n: number }).n;

describe('formatSerial', () => {
  it.each([
    ['HHT', 2026, 46, 'HHT-2026-000046'],
    ['SRA', 2025, 1, 'SRA-2025-000001'],
    ['LCL', 2026, 123456, 'LCL-2026-123456'],
    ['NHI', 2026, 1234567, 'NHI-2026-1234567'], // never truncated
  ])('%s %i #%i -> %s', (code, year, seq, expected) => {
    expect(formatSerial(code, year, seq)).toBe(expected);
  });
});

describe('allocateSerial', () => {
  it('hands out contiguous numbers continuing from the seed (HHT has 45)', () => {
    const db = createTestDb();
    const serials = [1, 2, 3].map(() => allocateSerial(db, HHT, '2026-10-20T01:00:00.000Z'));
    expect(serials).toEqual(['HHT-2026-000046', 'HHT-2026-000047', 'HHT-2026-000048']);
    expect(nextSerial(db, HHT.id)).toBe(49);
  });

  it('counts per tenant', () => {
    const db = createTestDb();
    const sraBefore = nextSerial(db, SRA.id);
    allocateSerial(db, HHT, '2026-10-20T01:00:00.000Z');
    expect(nextSerial(db, SRA.id)).toBe(sraBefore);
  });

  it('does not consume a number when the transaction rolls back', () => {
    const db = createTestDb();
    expect(() =>
      inTransaction(db, () => {
        allocateSerial(db, HHT, '2026-10-20T01:00:00.000Z');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(nextSerial(db, HHT.id)).toBe(46);
    expect(allocateSerial(db, HHT, '2026-10-20T01:00:00.000Z')).toBe('HHT-2026-000046');
  });

  it('uses the tenant-local year at the New Year boundary', () => {
    const db = createTestDb();
    const instant = '2025-12-31T14:30:00.000Z'; // 1 Jan 2026 01:30 in Sydney, 31 Dec 2025 22:30 in Perth
    expect(allocateSerial(db, HHT, instant)).toMatch(/^HHT-2026-/);
    expect(allocateSerial(db, SRA, instant)).toMatch(/^SRA-2025-/);
  });

  it('rejects an unknown tenant', () => {
    expect(() => allocateSerial(createTestDb(), { ...HHT, id: 999 }, '2026-10-20T01:00:00.000Z')).toThrow(/not found/);
  });
});
