import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router';
import { meQuery } from '../api/queries';
import { NotFound } from './NotFound';
import { QueryState } from './QueryState';
import { useCurrentTenant } from './useCurrentTenant';

export function AppLayout() {
  const me = useQuery(meQuery);
  const tenant = useCurrentTenant();

  return (
    <QueryState
      isPending={me.isPending}
      isError={me.isError}
      error={me.error}
      onRetry={() => void me.refetch()}
    >
      {tenant ? <Outlet /> : <NotFound />}
    </QueryState>
  );
}
