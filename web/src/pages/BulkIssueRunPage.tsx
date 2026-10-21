import type { BulkIssueRun, BulkIssueRunItem } from '@cac/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Progress, Segmented, Space, Statistic, Table, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { runQuery } from '../api/queries';
import { NotFound } from '../components/NotFound';
import { QueryState } from '../components/QueryState';
import { TzDate } from '../components/TzDate';
import { useCurrentTenant } from '../components/useCurrentTenant';
import { RUN_POLL_MS } from './bulk-issue/constants';
import { OutcomeTag } from './bulk-issue/OutcomeTag';
import { reasonText } from './bulk-issue/reasons';
import { useInvalidateOnComplete } from './bulk-issue/useInvalidateOnComplete';

export function BulkIssueRunPage() {
  const tenant = useCurrentTenant();
  const { runId } = useParams();
  if (!tenant) return null; // AppLayout only renders this page for an accessible tenant
  const id = /^[1-9]\d*$/.test(runId ?? '') ? Number(runId) : undefined;
  if (id === undefined) return <NotFound />;
  return <RunContent tid={tenant.id} timeZone={tenant.timezone} runId={id} />;
}

function RunContent({ tid, timeZone, runId }: { tid: number; timeZone: string; runId: number }) {
  const query = useQuery({
    ...runQuery(tid, runId),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? RUN_POLL_MS : false),
  });
  const run = query.data;
  useInvalidateOnComplete(tid, run?.status === 'completed');

  if (query.error instanceof ApiError && query.error.status === 404) return <NotFound />;

  return (
    <QueryState
      isPending={query.isPending}
      // A failed poll must not hide the progress already on screen.
      isError={query.isError && !run}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {run && <RunView run={run} tid={tid} timeZone={timeZone} />}
    </QueryState>
  );
}

type OutcomeFilter = 'all' | 'issued' | 'skipped' | 'failed';

function RunView({ run, tid, timeZone }: { run: BulkIssueRun; tid: number; timeZone: string }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<OutcomeFilter>('all');
  const running = run.status === 'running';
  const items = filter === 'all' ? run.items : run.items.filter((it) => it.outcome === filter);

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          {run.courseTitle}
        </Typography.Title>
        <Typography.Text type="secondary">
          Started by {run.createdBy.name} · <TzDate utc={run.createdAt} timeZone={timeZone} />
        </Typography.Text>
      </div>

      <Card>
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Text strong role="status">
            {running ? 'Issuing…' : 'Completed'}
          </Typography.Text>
          <Progress
            data-testid="run-progress"
            percent={run.total === 0 ? 100 : Math.floor((run.processed / run.total) * 100)}
            status={running ? 'active' : 'success'}
            format={() => `${run.processed} / ${run.total}`}
          />
          <Space size={48} wrap>
            <Statistic title="Issued" value={run.counts.issued} styles={{ content: { color: '#389e0d' } }} />
            <Statistic title="Skipped" value={run.counts.skipped} styles={{ content: { color: '#8c8c8c' } }} />
            <Statistic title="Failed" value={run.counts.failed} styles={{ content: { color: '#cf1322' } }} />
          </Space>
        </Space>
      </Card>

      <Space orientation="vertical" size="small" style={{ width: '100%' }}>
        <Segmented<OutcomeFilter>
          aria-label="Filter by outcome"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'issued', label: 'Issued' },
            { value: 'skipped', label: 'Skipped' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
        <Table<BulkIssueRunItem>
          size="small"
          rowKey="learnerId"
          dataSource={items}
          pagination={items.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          locale={{ emptyText: 'No learners with this outcome' }}
          onRow={() => ({ 'data-testid': 'run-item-row' }) as React.HTMLAttributes<HTMLElement>}
          columns={[
            { title: 'Learner', dataIndex: 'learnerName' },
            { title: 'Outcome', dataIndex: 'outcome', render: (o: BulkIssueRunItem['outcome']) => <OutcomeTag outcome={o} /> },
            { title: 'Reason', dataIndex: 'reason', render: (r: BulkIssueRunItem['reason']) => reasonText(r) },
            {
              title: 'Certificate',
              dataIndex: 'serial',
              render: (serial: string | null, item) =>
                serial && item.certificateId !== null ? (
                  <Link to={`/t/${tid}/certificates/${item.certificateId}`}>{serial}</Link>
                ) : null,
            },
          ]}
        />
      </Space>

      <div>
        <Button onClick={() => void navigate(`/t/${tid}/bulk-issue?courseId=${run.courseId}`)}>
          Back to bulk issue
        </Button>
      </div>
    </Space>
  );
}
