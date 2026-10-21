import type { CourseSummary } from '@cac/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Card, Empty, Modal, Select, Space, Statistic, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { ApiError } from '../api/client';
import { coursesQuery, runQuery } from '../api/queries';
import { QueryState } from '../components/QueryState';
import { useCurrentTenant } from '../components/useCurrentTenant';
import { useIdempotencyKey } from './bulk-issue/useIdempotencyKey';

export function BulkIssuePage() {
  const tenant = useCurrentTenant();
  if (!tenant) return null; // AppLayout only renders this page for an accessible tenant
  return <BulkIssueContent tid={tenant.id} />;
}

/** Only network errors are retried (max 2); every retry carries the same Idempotency-Key. */
const shouldRetry = (count: number, error: Error) =>
  error instanceof ApiError && error.status === 0 && count < 2;

function BulkIssueContent({ tid }: { tid: number }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const courses = useQuery(coursesQuery(tid));
  const { key, renew } = useIdempotencyKey();
  const [confirming, setConfirming] = useState(false);

  const items = courses.data?.items ?? [];
  const course = items.find((c) => String(c.id) === searchParams.get('courseId'));

  // A different course is a different intent, so it gets its own key.
  const lastCourseId = useRef(course?.id);
  useEffect(() => {
    if (lastCourseId.current === course?.id) return;
    lastCourseId.current = course?.id;
    renew();
  }, [course?.id, renew]);

  const issue = useMutation({
    mutationFn: (v: { courseId: number; key: string }) => api.bulkIssue(tid, v.courseId, v.key),
    retry: shouldRetry,
    retryDelay: (attempt) => 250 * 2 ** attempt,
    onSuccess: (run) => {
      queryClient.setQueryData(runQuery(tid, run.id).queryKey, run);
      renew();
      setConfirming(false);
      void navigate(`/t/${tid}/bulk-issue/runs/${run.id}`);
    },
    onError: (err) => {
      setConfirming(false);
      void message.error(err.message);
    },
  });

  // Guards a double click that lands before React has re-rendered the disabled button.
  const submitting = useRef(false);
  const confirm = () => {
    if (!course || submitting.current) return;
    submitting.current = true;
    issue.mutate(
      { courseId: course.id, key },
      { onSettled: () => (submitting.current = false) },
    );
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={2} style={{ margin: 0 }}>
        Bulk issue
      </Typography.Title>
      <QueryState
        isPending={courses.isPending}
        isError={courses.isError}
        error={courses.error}
        onRetry={() => void courses.refetch()}
        isEmpty={items.length === 0}
        empty={<Empty description="No courses yet" />}
      >
        <Select
          aria-label="Course"
          placeholder="Select a course"
          style={{ width: 360 }}
          value={course?.id}
          options={items.map((c) => ({ value: c.id, label: c.title }))}
          onChange={(id: number) => setSearchParams({ courseId: String(id) }, { replace: true })}
        />
        {course ? (
          <CourseDistribution course={course} pending={issue.isPending} onIssue={() => setConfirming(true)} />
        ) : (
          <Typography.Text type="secondary">
            Select a course to see how many learners can be issued a certificate.
          </Typography.Text>
        )}
        {course && (
          <Modal
            open={confirming}
            title={`Issue certificates for ${course.title}?`}
            okText="Issue certificates"
            confirmLoading={issue.isPending}
            cancelButtonProps={{ disabled: issue.isPending }}
            maskClosable={!issue.isPending}
            closable={!issue.isPending}
            keyboard={!issue.isPending}
            onOk={confirm}
            onCancel={() => setConfirming(false)}
          >
            <ConfirmSummary course={course} />
          </Modal>
        )}
      </QueryState>
    </Space>
  );
}

function CourseDistribution({
  course,
  pending,
  onIssue,
}: {
  course: CourseSummary;
  pending: boolean;
  onIssue: () => void;
}) {
  const { eligible, alreadyIssued, notCompleted, inactive } = course.counts;
  return (
    <Card>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text type="secondary">{course.enrolled} enrolled</Typography.Text>
        <Space size={48} wrap>
          <Statistic title="Eligible" value={eligible} styles={{ content: { color: '#389e0d' } }} />
          <Statistic title="Already issued" value={alreadyIssued} />
          <Statistic title="Not completed" value={notCompleted} />
          <Statistic title="Inactive" value={inactive} />
        </Space>
        <Space orientation="vertical" size={4}>
          <Button
            type="primary"
            disabled={eligible === 0 || pending}
            loading={pending}
            onClick={onIssue}
          >
            {`Issue ${eligible} ${eligible === 1 ? 'certificate' : 'certificates'}`}
          </Button>
          {eligible === 0 && (
            <Typography.Text type="secondary">
              Every enrolled learner already has a certificate or is not eligible.
            </Typography.Text>
          )}
        </Space>
      </Space>
    </Card>
  );
}

function ConfirmSummary({ course }: { course: CourseSummary }) {
  const { eligible, alreadyIssued, notCompleted, inactive } = course.counts;
  return (
    <Space orientation="vertical" size={4}>
      <Typography.Text strong>
        {eligible} {eligible === 1 ? 'certificate' : 'certificates'} will be issued.
      </Typography.Text>
      {alreadyIssued > 0 && (
        <Typography.Text>{alreadyIssued} already have a certificate and will be skipped.</Typography.Text>
      )}
      {notCompleted > 0 && (
        <Typography.Text>{notCompleted} have not completed the course and will be skipped.</Typography.Text>
      )}
      {inactive > 0 && (
        <Typography.Text>{inactive} inactive learner(s) will be reported as failed.</Typography.Text>
      )}
      <Typography.Text type="secondary">Issued certificates cannot be re-issued.</Typography.Text>
    </Space>
  );
}
