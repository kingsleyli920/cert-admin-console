import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { tenantKey } from '../../api/queries';
import { mockDetailBackend, revokedHht, validHht } from '../../test/certificateDetail';
import { useRevokeCertificate } from './useRevokeCertificate';

const detailKey = tenantKey(1, 'certificates', 'detail', 100);
const listKey = tenantKey(1, 'certificates', { page: 1 });

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Cached data without observers: invalidation marks it stale instead of refetching.
  queryClient.setQueryData(detailKey, validHht);
  queryClient.setQueryData(listKey, { items: [], total: 0, page: 1, pageSize: 20 });
  queryClient.setQueryData(tenantKey(1, 'certificates', 'detail', 101), revokedHht);
  queryClient.setQueryData(tenantKey(1, 'courses'), { items: [] });
  queryClient.setQueryData(tenantKey(2, 'certificates', { page: 1 }), { items: [] });
  const onClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AntApp>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AntApp>
  );
  const hook = renderHook(() => useRevokeCertificate(1, 100, onClose), { wrapper });
  const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
  return { queryClient, onClose, hook, stale };
}

describe('useRevokeCertificate', () => {
  it('caches the returned detail, invalidates this tenant\'s lists, other details and courses, and closes', async () => {
    mockDetailBackend();
    const { queryClient, onClose, hook, stale } = setup();

    await act(() => hook.result.current.mutateAsync('Issued in error'));

    expect(queryClient.getQueryData<typeof validHht>(detailKey)).toMatchObject({
      status: 'revoked',
      revokeReason: 'Issued in error',
    });
    expect(stale(detailKey)).toBe(false); // freshly set, no redundant refetch
    expect(stale(listKey)).toBe(true);
    expect(stale(tenantKey(1, 'certificates', 'detail', 101))).toBe(true);
    expect(stale(tenantKey(1, 'courses'))).toBe(true);
    expect(stale(tenantKey(2, 'certificates', { page: 1 }))).toBe(false); // another tenant
    expect(onClose).toHaveBeenCalledOnce();
    expect(await screen.findByText('Certificate revoked')).toBeInTheDocument();
  });

  it('on 409 warns, refetches the detail, closes and does not touch the lists', async () => {
    const backend = mockDetailBackend();
    backend.revokeElsewhere = true;
    const { onClose, hook, stale } = setup();

    await act(async () => {
      await hook.result.current.mutateAsync('Mine too').catch(() => undefined);
    });

    expect(await screen.findByText('This certificate was already revoked')).toBeInTheDocument();
    await waitFor(() => expect(stale(detailKey)).toBe(true));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('on any other error shows the server message and keeps the dialog open', async () => {
    const backend = mockDetailBackend();
    backend.failRevoke = { status: 500, code: 'INTERNAL_ERROR', message: 'Database is locked' };
    const { onClose, hook, stale } = setup();

    await act(async () => {
      await hook.result.current.mutateAsync('Try').catch(() => undefined);
    });

    expect(await screen.findByText('Database is locked')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(stale(listKey)).toBe(false);
  });
});
