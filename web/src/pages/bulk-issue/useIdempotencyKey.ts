import { useCallback, useState } from 'react';

/**
 * One Idempotency-Key per user intent. The key is stable across re-renders and automatic
 * retries of the same submission; `renew()` starts the next intent (after a successful
 * submission, or when the user picks a different course).
 */
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const renew = useCallback(() => setKey(crypto.randomUUID()), []);
  return { key, renew };
}
