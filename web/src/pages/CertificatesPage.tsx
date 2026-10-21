import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Empty, Typography } from 'antd';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { certificatesQuery } from '../api/queries';
import { QueryState } from '../components/QueryState';
import { useCurrentTenant } from '../components/useCurrentTenant';
import { CertificatesTable } from './certificates/CertificatesTable';
import { CertificatesToolbar } from './certificates/CertificatesToolbar';
import { useCertificateFilters } from './certificates/useCertificateFilters';

export function CertificatesPage() {
  const tenant = useCurrentTenant();
  if (!tenant) return null; // AppLayout only renders this page for an accessible tenant
  return <CertificatesContent tid={tenant.id} timeZone={tenant.timezone} />;
}

function CertificatesContent({ tid, timeZone }: { tid: number; timeZone: string }) {
  const navigate = useNavigate();
  const { filters, setFilters, clearFilters, hasActiveFilters } = useCertificateFilters();
  const query = useQuery({
    ...certificatesQuery(tid, filters),
    // Keep the previous page on screen while paging, but never another tenant's rows.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === tid ? keepPreviousData(previous) : undefined,
  });
  const { data } = query;

  // A page past the end (stale URL) jumps to the last real page.
  useEffect(() => {
    if (!data || data.items.length > 0 || data.total === 0) return;
    const lastPage = Math.ceil(data.total / filters.pageSize);
    if (filters.page > lastPage) setFilters({ page: lastPage });
  }, [data, filters.page, filters.pageSize, setFilters]);

  const noCertificatesYet = data?.total === 0 && !hasActiveFilters;

  const empty = hasActiveFilters ? (
    <Empty description="No certificates match your filters">
      <Button onClick={clearFilters}>Clear filters</Button>
    </Empty>
  ) : (
    <Empty description="No certificates yet">
      <Button type="primary" onClick={() => void navigate(`/t/${tid}/bulk-issue`)}>
        Bulk issue certificates
      </Button>
    </Empty>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Certificates
        </Typography.Title>
        {data && (
          <Typography.Text type="secondary">
            {data.total} {data.total === 1 ? 'certificate' : 'certificates'}
          </Typography.Text>
        )}
      </div>
      {!noCertificatesYet && <CertificatesToolbar tid={tid} filters={filters} onChange={setFilters} />}
      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        isEmpty={data?.total === 0}
        empty={empty}
      >
        {data && (
          <CertificatesTable
            tid={tid}
            timeZone={timeZone}
            items={data.items}
            total={data.total}
            filters={filters}
            loading={query.isFetching}
            onChange={setFilters}
          />
        )}
      </QueryState>
    </>
  );
}
