import { Readable } from 'node:stream';
import type { DatabaseSync } from 'node:sqlite';
import { CSV_BOM, csvRow, tenantLocalDate } from '@cac/shared';
import { openExportConnection } from '../../db/export-connection';
import type { TenantRow } from '../session/repo';
import { buildCertificateQuery, type CertificateFilters } from './query';

/** Rows per yielded chunk: big enough to amortise stream overhead, small enough to stay flat in memory. */
const BATCH_ROWS = 500;

interface ExportRow {
  learner_name: string;
  course_title: string;
  serial: string;
  issued_at: string;
}

export function exportFileName(tenant: TenantRow, now: Date): string {
  return `certificates-${tenant.code}-${tenantLocalDate(now.toISOString(), tenant.timezone)}.csv`;
}

/**
 * The tenant's certificates matching `filters` as CSV text: BOM, header row, then one row per
 * certificate in the list's order (same `buildCertificateQuery`, no LIMIT).
 *
 * Streams (SPEC §2.6 #4): a generator walks `stmt.iterate()` and `Readable.from` pulls from it
 * only as fast as the client reads, so memory stays flat for any tenant size. All resources are
 * opened inside the generator's `try`, so `finally` releases the snapshot connection both after
 * the last row and when the client aborts and the stream is destroyed.
 */
export function certificateCsvStream(
  shared: DatabaseSync,
  dbPath: string,
  tenant: TenantRow,
  filters: CertificateFilters,
): Readable {
  async function* chunks(): AsyncGenerator<string> {
    const conn = openExportConnection(shared, dbPath);
    try {
      const q = buildCertificateQuery(tenant.id, filters);
      const stmt = conn.db.prepare(
        `SELECT l.name AS learner_name, co.title AS course_title, c.serial, c.issued_at
           ${q.from}
          WHERE ${q.where}
          ORDER BY ${q.orderBy}`,
      );
      yield CSV_BOM + csvRow(['Learner Name', 'Course Title', 'Serial Number', `Issue Date (${tenant.timezone})`]);

      let batch = '';
      let rows = 0;
      for (const row of stmt.iterate(...q.params) as IterableIterator<unknown>) {
        const r = row as ExportRow;
        batch += csvRow([r.learner_name, r.course_title, r.serial, tenantLocalDate(r.issued_at, tenant.timezone)]);
        if (++rows % BATCH_ROWS === 0) {
          yield batch;
          batch = '';
        }
      }
      if (batch) yield batch;
    } finally {
      conn.close();
    }
  }
  // Byte mode (not objectMode) so the high-water mark counts bytes and backpressure is real.
  return Readable.from(chunks(), { objectMode: false });
}
