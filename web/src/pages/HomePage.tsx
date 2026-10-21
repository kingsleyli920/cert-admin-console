import { Alert, Button, Result, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.getHealth() });

  if (health.isPending) {
    return (
      <div role="status" style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
        <div style={{ marginTop: 12 }}>Checking API status…</div>
      </div>
    );
  }

  if (health.isError) {
    return (
      <Alert
        type="error"
        showIcon
        title="Cannot reach the API"
        description={health.error.message}
        action={
          <Button size="small" onClick={() => void health.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  return <Result status="success" title="API is healthy" subTitle={`status: ${health.data.status}`} />;
}
