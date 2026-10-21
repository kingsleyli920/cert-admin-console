import { queryOptions } from '@tanstack/react-query';
import type { CertificateListQuery } from '@cac/shared';
import { api } from '.';

/**
 * Query key rule: every tenant-scoped query key starts with `['tenant', tid, ...]`
 * (tid = the numeric tenant id from the route), e.g. `['tenant', tid, 'certificates', filters]`.
 * That keeps cached data from one tenant from ever being shown for another, and lets
 * `queryClient.removeQueries({ queryKey: ['tenant', tid] })` drop a tenant's data at once.
 * Session-level queries such as `['me']` are not tenant-scoped.
 */
export const tenantKey = (tid: number, ...rest: unknown[]) => ['tenant', tid, ...rest] as const;

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => api.getMe(),
  staleTime: 5 * 60_000,
});

export const certificatesQuery = (tid: number, query: CertificateListQuery) =>
  queryOptions({
    queryKey: tenantKey(tid, 'certificates', query),
    queryFn: () => api.listCertificates(tid, query),
  });

/**
 * Detail key: `['tenant', tid, 'certificates', 'detail', id]`. It sits under the list prefix
 * `['tenant', tid, 'certificates']` so one prefix invalidation covers lists and details. It cannot
 * collide with a list key `['tenant', tid, 'certificates', filters]`: there the 4th element is the
 * filters object, never the string 'detail', and the detail key has a 5th element.
 */
export const certificateDetailQuery = (tid: number, id: number) =>
  queryOptions({
    queryKey: tenantKey(tid, 'certificates', 'detail', id),
    queryFn: () => api.getCertificate(tid, id),
  });

export const coursesQuery = (tid: number) =>
  queryOptions({
    queryKey: tenantKey(tid, 'courses'),
    queryFn: () => api.listCourses(tid),
  });

export const runQuery = (tid: number, runId: number) =>
  queryOptions({
    queryKey: tenantKey(tid, 'bulk-issue-runs', runId),
    queryFn: () => api.getRun(tid, runId),
  });
