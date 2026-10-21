import type { CertificateListQuery } from '@cac/shared';
import { describe, expect, it } from 'vitest';
import { exportCsvUrl } from './exportUrl';

const DEFAULTS: CertificateListQuery = {
  q: undefined,
  courseId: undefined,
  status: undefined,
  sort: 'issuedAt',
  order: 'desc',
  page: 1,
  pageSize: 20,
};

describe('exportCsvUrl', () => {
  it('returns the bare export URL when no filter is set', () => {
    expect(exportCsvUrl(1, DEFAULTS)).toBe('/api/tenants/1/certificates/export.csv');
  });

  it('includes q, courseId, status, sort and order when they are set', () => {
    const url = exportCsvUrl(2, {
      ...DEFAULTS,
      q: 'emma',
      courseId: 3,
      status: 'revoked',
      sort: 'serial',
      order: 'asc',
    });
    const [path, query] = url.split('?');
    expect(path).toBe('/api/tenants/2/certificates/export.csv');
    const sp = new URLSearchParams(query);
    expect(sp.get('q')).toBe('emma');
    expect(sp.get('courseId')).toBe('3');
    expect(sp.get('status')).toBe('revoked');
    expect(sp.get('sort')).toBe('serial');
    expect(sp.get('order')).toBe('asc');
  });

  it('never includes page or pageSize, even when they differ from the defaults', () => {
    const url = exportCsvUrl(1, { ...DEFAULTS, page: 3, pageSize: 50, q: 'emma' });
    const sp = new URLSearchParams(url.split('?')[1]);
    expect(sp.has('page')).toBe(false);
    expect(sp.has('pageSize')).toBe(false);
    expect(sp.get('q')).toBe('emma');
  });

  it('URL-encodes special characters in q', () => {
    const url = exportCsvUrl(1, { ...DEFAULTS, q: 'a&b=c d+e#f' });
    expect(url).toBe('/api/tenants/1/certificates/export.csv?q=a%26b%3Dc+d%2Be%23f');
    expect(new URLSearchParams(url.split('?')[1]).get('q')).toBe('a&b=c d+e#f');
  });
});
