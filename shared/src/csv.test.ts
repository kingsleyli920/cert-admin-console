import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, csvRow } from './csv';

describe('csvCell', () => {
  it.each([
    ['plain text stays as is', 'Emma Wilson', 'Emma Wilson'],
    ['non-ASCII is preserved', 'Zoë Ñúñez', 'Zoë Ñúñez'],
    ['a comma forces quoting', 'Wilson, Emma', '"Wilson, Emma"'],
    ['quotes are doubled inside quotes', 'Emma "Em" Wilson', '"Emma ""Em"" Wilson"'],
    ['a line feed forces quoting', 'line1\nline2', '"line1\nline2"'],
    ['a carriage return forces quoting', 'line1\rline2', '"line1\rline2"'],
    ['empty stays empty', '', ''],
  ])('%s', (_label, input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  // Spreadsheet formula injection (OWASP): neutralise cells a spreadsheet would evaluate.
  it.each([
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['+61 400 000 000', "'+61 400 000 000"],
    ['-2+3', "'-2+3"],
    ['@cmd', "'@cmd"],
    ['\tTAB', "'\tTAB"],
    ['\rCR', `"'\rCR"`],
  ])('neutralises a leading formula character in %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('applies the formula guard before quoting', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it('leaves formula characters alone when they are not the first character', () => {
    expect(csvCell('HHT-2026-000001')).toBe('HHT-2026-000001');
    expect(csvCell('a=b')).toBe('a=b');
  });
});

describe('csvRow', () => {
  it('joins cells with commas and ends with CRLF (RFC 4180)', () => {
    expect(csvRow(['Emma Wilson', 'Fire Safety 2026', 'HHT-2026-000046', '2026-10-20'])).toBe(
      'Emma Wilson,Fire Safety 2026,HHT-2026-000046,2026-10-20\r\n',
    );
  });

  it('escapes every cell', () => {
    expect(csvRow(['=1', 'a,b'])).toBe(`'=1,"a,b"\r\n`);
  });
});

describe('CSV_BOM', () => {
  it('is the UTF-8 byte order mark so Excel detects UTF-8', () => {
    expect(CSV_BOM).toHaveLength(1);
    expect(CSV_BOM.codePointAt(0)).toBe(0xfeff); // U+FEFF, encoded as EF BB BF in UTF-8
  });
});
