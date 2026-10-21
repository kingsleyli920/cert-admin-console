/**
 * Tiny RFC 4180 parser for tests: quoted fields may contain commas, quotes (`""`) and line
 * breaks; records end at CRLF or LF; a trailing line break does not add an empty record.
 * The caller strips the BOM first (so tests can assert on it separately).
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r' && text[i + 1] === '\n') {
      endRecord();
      i++;
    } else if (ch === '\n') {
      endRecord();
    } else {
      field += ch;
    }
    i++;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (field !== '' || record.length > 0) endRecord();
  return records;
}
