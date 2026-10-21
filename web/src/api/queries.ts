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
