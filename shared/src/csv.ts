// CSV encoding for the certificate export (SPEC §1.4): RFC 4180 quoting plus a guard against
// spreadsheet formula injection, so a learner named "=HYPERLINK(...)" stays plain text.

/** UTF-8 byte order mark; lets Excel open the file as UTF-8. Written once, before the header. */
export const CSV_BOM = '﻿';

// A spreadsheet evaluates a cell that starts with one of these (OWASP CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** One field: formula guard first, then RFC 4180 quoting. */
export function csvCell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** One record, CRLF-terminated. */
export function csvRow(cells: readonly string[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}
