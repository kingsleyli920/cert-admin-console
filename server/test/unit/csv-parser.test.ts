import { describe, expect, it } from 'vitest';
import { csvRow } from '@cac/shared';
import { parseCsv } from '../helpers/csv';

describe('parseCsv (test helper)', () => {
  it('splits plain records on CRLF and ignores the trailing line break', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('keeps commas, doubled quotes and line breaks inside quoted fields', () => {
    expect(parseCsv('"Smith, ""Jo""",x\r\n"two\nlines",y\r\n')).toEqual([['Smith, "Jo"', 'x'], ['two\nlines', 'y']]);
  });
  it('keeps empty fields', () => {
    expect(parseCsv(',\r\n"",z')).toEqual([['', ''], ['', 'z']]);
  });
  it('round-trips what csvRow writes', () => {
    const cells = ["'=SUM(A1)", 'a,"b"', 'plain', ''];
    expect(parseCsv(csvRow(cells))).toEqual([cells]);
  });
  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('"abc')).toThrow(/unterminated/);
  });
});
