import { describe, expect, it } from 'vitest';
import { formatInTenantTz, formatUtc, tenantLocalDate, tenantLocalYear } from './time';

const SYDNEY = 'Australia/Sydney';
const PERTH = 'Australia/Perth';
const BRISBANE = 'Australia/Brisbane';

// Sydney DST ends 2026-04-05 03:00 AEDT (= 2026-04-04T16:00Z) and starts
// 2026-10-04 02:00 AEST (= 2026-10-03T16:00Z). Perth and Brisbane have no DST.
describe('formatInTenantTz', () => {
  it.each([
    ['2026-04-04T14:30:00.000Z', SYDNEY, '5 Apr 2026, 1:30 am AEDT'], // still daylight time
    ['2026-04-04T16:30:00.000Z', SYDNEY, '5 Apr 2026, 2:30 am AEST'], // after DST ended
    ['2026-10-04T16:30:00.000Z', SYDNEY, '5 Oct 2026, 3:30 am AEDT'], // after DST started
    ['2026-04-04T14:30:00.000Z', PERTH, '4 Apr 2026, 10:30 pm AWST'],
    ['2026-01-15T00:00:00.000Z', BRISBANE, '15 Jan 2026, 10:00 am AEST'],
  ])('%s in %s → %s', (utc, tz, expected) => {
    expect(formatInTenantTz(utc, tz)).toBe(expected);
  });

  it('renders the same instant on different calendar dates for Sydney and Perth', () => {
    const instant = '2026-04-04T14:30:00.000Z';
    expect(formatInTenantTz(instant, SYDNEY)).toMatch(/^5 Apr 2026/);
    expect(formatInTenantTz(instant, PERTH)).toMatch(/^4 Apr 2026/);
  });

  it('rejects an invalid timestamp', () => {
    expect(() => formatInTenantTz('not-a-date', SYDNEY)).toThrow(RangeError);
  });

  it('rejects an unknown timezone', () => {
    expect(() => formatInTenantTz('2026-04-04T14:30:00.000Z', 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('tenantLocalDate', () => {
  it.each([
    ['2026-04-04T14:30:00.000Z', SYDNEY, '2026-04-05'],
    ['2026-04-04T14:30:00.000Z', PERTH, '2026-04-04'],
    ['2025-12-31T14:00:00.000Z', SYDNEY, '2026-01-01'], // 01:00 AEDT on New Year's Day
    ['2025-12-31T14:00:00.000Z', PERTH, '2025-12-31'], // 22:00 AWST, still New Year's Eve
  ])('%s in %s → %s', (utc, tz, expected) => {
    expect(tenantLocalDate(utc, tz)).toBe(expected);
  });
});

describe('tenantLocalYear', () => {
  it('uses the tenant-local year across the New Year boundary', () => {
    expect(tenantLocalYear('2025-12-31T14:00:00.000Z', SYDNEY)).toBe(2026);
    expect(tenantLocalYear('2025-12-31T14:00:00.000Z', PERTH)).toBe(2025);
  });
});

describe('formatUtc', () => {
  it('formats the raw UTC instant for hover text', () => {
    expect(formatUtc('2026-04-04T14:30:00.000Z')).toBe('2026-04-04 14:30 UTC');
  });
});
