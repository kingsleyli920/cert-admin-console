import { idempotencyKeySchema } from '@cac/shared';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { useIdempotencyKey } from './useIdempotencyKey';

describe('useIdempotencyKey', () => {
  it('starts with a valid UUID', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    expect(idempotencyKeySchema.safeParse(result.current.key).success).toBe(true);
  });

  it('keeps the same key across re-renders', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;
    rerender();
    rerender();
    expect(result.current.key).toBe(first);
  });

  it('gives each hook instance its own key', () => {
    const a = renderHook(() => useIdempotencyKey());
    const b = renderHook(() => useIdempotencyKey());
    expect(a.result.current.key).not.toBe(b.result.current.key);
  });

  it('renew() replaces the key with a new valid UUID and keeps renew stable', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const { key: first, renew } = result.current;

    act(() => result.current.renew());

    expect(result.current.key).not.toBe(first);
    expect(idempotencyKeySchema.safeParse(result.current.key).success).toBe(true);
    expect(result.current.renew).toBe(renew);
  });
});
