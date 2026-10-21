import type { TenantSummary } from '@cac/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { meQuery } from '../api/queries';

/** The tenant for the route's `:tid`, or undefined while `me` loads or if the admin lacks access. */
export function useCurrentTenant(): TenantSummary | undefined {
  const { tid } = useParams();
  const { data } = useQuery(meQuery);
  return data?.tenants.find((t) => String(t.id) === tid);
}
