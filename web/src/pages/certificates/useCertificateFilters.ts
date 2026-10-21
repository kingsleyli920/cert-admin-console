import { certificateListQuerySchema, type CertificateListQuery } from '@cac/shared';
import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';

const fields = certificateListQuerySchema.shape;
const DEFAULTS = certificateListQuerySchema.parse({});

/** First valid value from the schema field, or `undefined` (so defaults/optional apply). */
function field<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, raw: string | null) {
  if (raw === null) return undefined;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Reads the URL one field at a time; anything invalid or out of range falls back to its default. */
export function parseFilters(sp: URLSearchParams): CertificateListQuery {
  return {
    q: field(fields.q, sp.get('q')) || undefined,
    courseId: field(fields.courseId, sp.get('courseId')),
    status: field(fields.status, sp.get('status')),
    sort: field(fields.sort, sp.get('sort')) ?? DEFAULTS.sort,
    order: field(fields.order, sp.get('order')) ?? DEFAULTS.order,
    page: field(fields.page, sp.get('page')) ?? DEFAULTS.page,
    pageSize: field(fields.pageSize, sp.get('pageSize')) ?? DEFAULTS.pageSize,
  };
}

/** Inverse of `parseFilters`; values equal to their default are left out of the URL. */
export function serializeFilters(filters: CertificateListQuery): URLSearchParams {
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.courseId !== undefined) sp.set('courseId', String(filters.courseId));
  if (filters.status) sp.set('status', filters.status);
  if (filters.sort !== DEFAULTS.sort) sp.set('sort', filters.sort);
  if (filters.order !== DEFAULTS.order) sp.set('order', filters.order);
  if (filters.page !== DEFAULTS.page) sp.set('page', String(filters.page));
  if (filters.pageSize !== DEFAULTS.pageSize) sp.set('pageSize', String(filters.pageSize));
  return sp;
}

const RESETS_PAGE = ['q', 'courseId', 'status', 'pageSize'] as const;

/** Certificate list filters, sorting and paging, kept in the URL query string. */
export function useCertificateFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  // react-router's functional update sees the params of the last render, so two updates in one
  // tick would overwrite each other; track the most recent params ourselves.
  const latest = useRef(searchParams);
  latest.current = searchParams;

  const setFilters = useCallback(
    (patch: Partial<CertificateListQuery>) => {
      const next = { ...parseFilters(latest.current), ...patch };
      const resetsPage = RESETS_PAGE.some((key) => key in patch) && !('page' in patch);
      const params = serializeFilters(resetsPage ? { ...next, page: 1 } : next);
      latest.current = params;
      // Typing in the search box should not fill the history with one entry per keystroke.
      setSearchParams(params, { replace: Object.keys(patch).length === 1 && 'q' in patch });
    },
    [setSearchParams],
  );

  /** Resets q, courseId, status and the page; sort and page size are kept. */
  const clearFilters = useCallback(
    () => setFilters({ q: undefined, courseId: undefined, status: undefined }),
    [setFilters],
  );

  const hasActiveFilters = Boolean(filters.q) || filters.courseId !== undefined || !!filters.status;

  return { filters, setFilters, clearFilters, hasActiveFilters };
}
