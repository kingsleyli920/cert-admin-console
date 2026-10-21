// Tenant-local time formatting. Timestamps are stored as UTC ISO strings and the
// tenant's IANA timezone decides how they read — never a fixed UTC offset, because
// offsets change with daylight saving (Sydney) or don't (Perth, Brisbane).

const LOCALE = 'en-AU';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, options); // throws RangeError for unknown timezones
    formatters.set(key, f);
  }
  return f;
}

function parseUtc(utcIso: string): Date {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid timestamp: ${utcIso}`);
  return date;
}

// Some ICU versions separate "1:30" and "am" with a (narrow) no-break space.
const normalizeSpaces = (s: string) => s.replace(/[  ]/g, ' ');

/** e.g. "5 Apr 2026, 1:30 am AEDT" — date, time and zone abbreviation in the tenant's timezone. */
export function formatInTenantTz(utcIso: string, timeZone: string): string {
  const f = formatter(`full|${timeZone}`, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return normalizeSpaces(f.format(parseUtc(utcIso)));
}

function localParts(utcIso: string, timeZone: string) {
  const f = formatter(`parts|${timeZone}`, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    f.formatToParts(parseUtc(utcIso)).map((p) => [p.type, p.value]),
  );
  return { year: parts.year!, month: parts.month!, day: parts.day! };
}

/** Tenant-local calendar date as YYYY-MM-DD (used for CSV export and file names). */
export function tenantLocalDate(utcIso: string, timeZone: string): string {
  const { year, month, day } = localParts(utcIso, timeZone);
  return `${year}-${month}-${day}`;
}

/** Tenant-local calendar year (used in certificate serial numbers). */
export function tenantLocalYear(utcIso: string, timeZone: string): number {
  return Number(localParts(utcIso, timeZone).year);
}

/** Raw UTC instant for hover text, e.g. "2026-04-04 14:30 UTC". */
export function formatUtc(utcIso: string): string {
  return `${parseUtc(utcIso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
