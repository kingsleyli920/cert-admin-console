import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { meQuery } from '../api/queries';
import { NotFound } from '../components/NotFound';
import { QueryState } from '../components/QueryState';

/** `/`: signed-in admins go to their first tenant; a 401 is redirected globally (see App). */
export function RootRedirect() {
  const me = useQuery(meQuery);
  const first = me.data?.tenants[0];

  return (
    <QueryState
      isPending={me.isPending}
      isError={me.isError}
      error={me.error}
      onRetry={() => void me.refetch()}
    >
      {first ? <Navigate to={`/t/${first.id}/certificates`} replace /> : <NotFound />}
    </QueryState>
  );
}
