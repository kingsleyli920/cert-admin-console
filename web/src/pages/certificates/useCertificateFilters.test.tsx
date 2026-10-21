import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { parseFilters, serializeFilters, useCertificateFilters } from './useCertificateFilters';

const DEFAULTS = {
  q: undefined,
  courseId: undefined,
  status: undefined,
  sort: 'issuedAt',
  order: 'desc',
  page: 1,
  pageSize: 20,
};

function setup(initial: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ hook: useCertificateFilters(), location: useLocation() }), {
    wrapper,
  });
}

describe('parseFilters', () => {
  it('returns the defaults for an empty query string', () => {
    expect(parseFilters(new URLSearchParams())).toEqual(DEFAULTS);
  });

  it('reads every field from the URL', () => {
    const sp = new URLSearchParams(
      'q=emma&courseId=3&status=revoked&sort=serial&order=asc&page=2&pageSize=50',
    );
    expect(parseFilters(sp)).toEqual({
      q: 'emma',
      courseId: 3,
      status: 'revoked',
      sort: 'serial',
      order: 'asc',
      page: 2,
      pageSize: 50,
    });
  });

  it.each([
    ['sort=bogus', { sort: 'issuedAt' }],
    ['order=sideways', { order: 'desc' }],
    ['page=0', { page: 1 }],
    ['page=-3', { page: 1 }],
    ['page=abc', { page: 1 }],
    ['page=1.5', { page: 1 }],
    ['pageSize=500', { pageSize: 20 }],
    ['pageSize=0', { pageSize: 20 }],
    ['courseId=0', { courseId: undefined }],
    ['courseId=abc', { courseId: undefined }],
    ['status=pending', { status: undefined }],
    ['q=', { q: undefined }],
    [`q=${'x'.repeat(101)}`, { q: undefined }],
  ])('falls back to the default for invalid %s', (query, expected) => {
    expect(parseFilters(new URLSearchParams(query))).toEqual({ ...DEFAULTS, ...expected });
  });

  it('trims the search text', () => {
    expect(parseFilters(new URLSearchParams('q=%20emma%20')).q).toBe('emma');
  });
});

describe('serializeFilters', () => {
  it('omits every default value', () => {
    expect(serializeFilters(parseFilters(new URLSearchParams())).toString()).toBe('');
  });

  it('writes only the non-default fields', () => {
    const sp = serializeFilters({ ...DEFAULTS, q: 'emma', status: 'valid', page: 2 } as never);
    expect(Object.fromEntries(sp)).toEqual({ q: 'emma', status: 'valid', page: '2' });
  });
});

describe('useCertificateFilters', () => {
  it('exposes the parsed filters and whether any filter is active', () => {
    const { result } = setup('/t/1/certificates?q=emma&sort=serial');
    expect(result.current.hook.filters).toMatchObject({ q: 'emma', sort: 'serial' });
    expect(result.current.hook.hasActiveFilters).toBe(true);
  });

  it('treats sort, order and paging alone as no active filter', () => {
    const { result } = setup('/t/1/certificates?sort=serial&order=asc&page=2&pageSize=50');
    expect(result.current.hook.hasActiveFilters).toBe(false);
  });

  it('writes a changed filter to the URL', () => {
    const { result } = setup('/t/1/certificates');
    act(() => result.current.hook.setFilters({ status: 'revoked' }));
    expect(result.current.location.search).toBe('?status=revoked');
    expect(result.current.hook.filters.status).toBe('revoked');
  });

  it.each([
    ['q', { q: 'x' }],
    ['courseId', { courseId: 4 }],
    ['status', { status: 'valid' as const }],
    ['pageSize', { pageSize: 50 }],
  ])('changing %s resets the page to 1', (_name, patch) => {
    const { result } = setup('/t/1/certificates?page=3');
    act(() => result.current.hook.setFilters(patch));
    expect(result.current.hook.filters.page).toBe(1);
    expect(new URLSearchParams(result.current.location.search).has('page')).toBe(false);
  });

  it('keeps the page when only the page changes', () => {
    const { result } = setup('/t/1/certificates?q=emma');
    act(() => result.current.hook.setFilters({ page: 2 }));
    expect(new URLSearchParams(result.current.location.search).get('page')).toBe('2');
    expect(new URLSearchParams(result.current.location.search).get('q')).toBe('emma');
  });

  it('removes a param when its filter is cleared', () => {
    const { result } = setup('/t/1/certificates?q=emma&status=valid');
    act(() => result.current.hook.setFilters({ status: undefined }));
    expect(result.current.location.search).toBe('?q=emma');
  });

  it('clearFilters resets q, courseId, status and page but keeps the sort', () => {
    const { result } = setup(
      '/t/1/certificates?q=zzz&courseId=2&status=valid&sort=learnerName&order=asc&page=2&pageSize=50',
    );
    act(() => result.current.hook.clearFilters());
    expect(Object.fromEntries(new URLSearchParams(result.current.location.search))).toEqual({
      sort: 'learnerName',
      order: 'asc',
      pageSize: '50',
    });
  });

  it('successive updates in one tick do not lose each other', () => {
    const { result } = setup('/t/1/certificates');
    act(() => {
      result.current.hook.setFilters({ q: 'a' });
      result.current.hook.setFilters({ status: 'valid' });
    });
    expect(Object.fromEntries(new URLSearchParams(result.current.location.search))).toEqual({
      q: 'a',
      status: 'valid',
    });
  });
});
