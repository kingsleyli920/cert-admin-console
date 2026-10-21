import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { meQuery } from '../api/queries';
import { aliceMe, HHT } from '../test/fixtures';
import { useCurrentTenant } from './useCurrentTenant';

function renderAt(path: string) {
  const client = new QueryClient();
  client.setQueryData(meQuery.queryKey, aliceMe);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/t/:tid/*" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useCurrentTenant(), { wrapper });
}

describe('useCurrentTenant', () => {
  it('returns the tenant matching the route tid', () => {
    expect(renderAt('/t/1/certificates').result.current).toEqual(HHT);
  });

  it('returns undefined for a tenant the admin does not have', () => {
    expect(renderAt('/t/3/certificates').result.current).toBeUndefined();
  });

  it('returns undefined for a non-numeric tid', () => {
    expect(renderAt('/t/abc/certificates').result.current).toBeUndefined();
  });
});
