import type { CertificateDetail } from '@cac/shared';
import { useQuery } from '@tanstack/react-query';
import { Descriptions, Space, Typography, type DescriptionsProps } from 'antd';
import { Link, useLocation, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { certificateDetailQuery } from '../api/queries';
import { NotFound } from '../components/NotFound';
import { QueryState } from '../components/QueryState';
import { StatusTag } from '../components/StatusTag';
import { TzDate } from '../components/TzDate';
import { useCurrentTenant } from '../components/useCurrentTenant';
import { AuditTrail } from './certificate-detail/AuditTrail';
import { RevokeAction } from './certificate-detail/RevokeAction';

export function CertificateDetailPage() {
  const tenant = useCurrentTenant();
  const { id } = useParams();
  if (!tenant) return null; // AppLayout only renders this page for an accessible tenant
  const certId = /^[1-9]\d*$/.test(id ?? '') ? Number(id) : undefined;
  if (certId === undefined) return <NotFound />;
  return <DetailContent tid={tenant.id} timeZone={tenant.timezone} id={certId} />;
}

function DetailContent({ tid, timeZone, id }: { tid: number; timeZone: string; id: number }) {
  const query = useQuery(certificateDetailQuery(tid, id));
  const { data } = query;

  // A missing certificate and another tenant's look the same on purpose.
  if (query.error instanceof ApiError && query.error.status === 404) return <NotFound />;

  return (
    <QueryState
      isPending={query.isPending}
      isError={query.isError && !data}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {data && <DetailView cert={data} tid={tid} timeZone={timeZone} />}
    </QueryState>
  );
}

function DetailView({ cert, tid, timeZone }: { cert: CertificateDetail; tid: number; timeZone: string }) {
  const location = useLocation();
  // The list passes its query string along so "back" restores the filters, sort and page.
  const from = (location.state as { from?: unknown } | null)?.from;
  const backSearch = typeof from === 'string' ? from : '';

  const items: DescriptionsProps['items'] = [
    { key: 'serial', label: 'Serial number', children: cert.serial },
    { key: 'learner', label: 'Learner', children: cert.learnerName },
    { key: 'course', label: 'Course', children: cert.courseTitle },
    {
      key: 'issued',
      label: 'Issued',
      children: (
        <Space size="small" wrap>
          <TzDate utc={cert.issuedAt} timeZone={timeZone} />
          <Typography.Text type="secondary">{timeZone}</Typography.Text>
        </Space>
      ),
    },
    { key: 'issuedBy', label: 'Issued by', children: cert.issuedBy.name },
    { key: 'status', label: 'Status', children: <StatusTag status={cert.status} /> },
  ];
  if (cert.status === 'revoked') {
    items.push(
      {
        key: 'revoked',
        label: 'Revoked',
        children: cert.revokedAt && <TzDate utc={cert.revokedAt} timeZone={timeZone} />,
      },
      { key: 'revokedBy', label: 'Revoked by', children: cert.revokedBy?.name },
      { key: 'reason', label: 'Reason', span: 'filled', children: cert.revokeReason },
    );
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Link to={{ pathname: `/t/${tid}/certificates`, search: backSearch }}>← Certificates</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            {cert.serial}
          </Typography.Title>
          <StatusTag status={cert.status} />
          <div style={{ flex: 1 }} />
          <RevokeAction tid={tid} id={cert.id} serial={cert.serial} canRevoke={cert.status === 'valid'} />
        </div>
      </div>

      <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} items={items} />

      <AuditTrail tid={tid} timeZone={timeZone} entries={cert.audit} />
    </Space>
  );
}
