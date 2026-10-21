import { Button, Empty, Result, Spin } from 'antd';
import type { ReactNode } from 'react';

export interface QueryStateProps {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
  /** True when the query succeeded but returned no rows. */
  isEmpty?: boolean;
  /** Rendered when `isEmpty`; defaults to a plain "No data" placeholder. */
  empty?: ReactNode;
  children: ReactNode;
}

/** The three data-view states (loading, error with retry, empty); otherwise the children. */
export function QueryState({
  isPending,
  isError,
  error,
  onRetry,
  isEmpty,
  empty,
  children,
}: QueryStateProps) {
  if (isPending) {
    return (
      <div role="status" aria-label="Loading" style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert">
        <Result
          status="error"
          title="Something went wrong"
          subTitle={error?.message ?? 'Unexpected error'}
          extra={<Button onClick={onRetry}>Retry</Button>}
        />
      </div>
    );
  }

  if (isEmpty) return <>{empty ?? <Empty description="No data" />}</>;

  return <>{children}</>;
}
