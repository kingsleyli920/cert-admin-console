import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useInvalidateOnComplete } from './useInvalidateOnComplete';

function setup(initial: boolean) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ done }) => useInvalidateOnComplete(1, done), {
    wrapper,
    initialProps: { done: initial },
  });
  return { invalidate, ...hook };
}

describe('useInvalidateOnComplete', () => {
  it('does nothing while the run is still running', () => {
    const { invalidate, rerender } = setup(false);
    rerender({ done: false });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('invalidates the tenant certificates and courses once when the run completes', () => {
    const { invalidate, rerender } = setup(false);

    rerender({ done: true });
    rerender({ done: true });

    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['tenant', 1, 'certificates'],
      ['tenant', 1, 'courses'],
    ]);
  });
});
