import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { tenantKey } from '../../api/queries';

/** Once the run is completed, its issued certificates make cached lists and course counts stale. */
export function useInvalidateOnComplete(tid: number, completed: boolean) {
  const queryClient = useQueryClient();
  const done = useRef(false);
  useEffect(() => {
    if (!completed || done.current) return;
    done.current = true;
    void queryClient.invalidateQueries({ queryKey: tenantKey(tid, 'certificates') });
    void queryClient.invalidateQueries({ queryKey: tenantKey(tid, 'courses') });
  }, [completed, tid, queryClient]);
}
