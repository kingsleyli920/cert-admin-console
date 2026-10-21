import type { BulkIssueRunItem } from '@cac/shared';
import { Tag } from 'antd';

const OUTCOME = {
  issued: { color: 'green', label: 'Issued' },
  skipped: { color: 'default', label: 'Skipped' },
  failed: { color: 'red', label: 'Failed' },
  pending: { color: 'default', label: 'Pending' },
} as const;

/** Run item outcome; colour is always paired with the text label. */
export function OutcomeTag({ outcome }: { outcome: BulkIssueRunItem['outcome'] }) {
  const { color, label } = OUTCOME[outcome];
  return (
    <Tag color={color} data-testid="outcome-tag" style={{ marginInlineEnd: 0 }}>
      {label}
    </Tag>
  );
}
