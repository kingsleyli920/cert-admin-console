import type { CertificateListQuery } from '@cac/shared';
import { serializeFilters } from './useCertificateFilters';

/**
 * Link to the CSV export of the current list filters (spec 1.4). Paging does not apply to the
 * export, so `page` and `pageSize` are left out.
 */
export function exportCsvUrl(tid: number, filters: CertificateListQuery): string {
  const params = serializeFilters(filters);
  params.delete('page');
  params.delete('pageSize');
  const query = params.toString();
  return `/api/tenants/${tid}/certificates/export.csv${query ? `?${query}` : ''}`;
}
