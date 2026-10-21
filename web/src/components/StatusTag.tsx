import type { CertificateListItem } from '@cac/shared';
import { Tag } from 'antd';

const STATUS = {
  valid: { color: 'green', label: 'Valid' },
  revoked: { color: 'red', label: 'Revoked' },
} as const;

/** Certificate status; colour is always paired with the text label. */
export function StatusTag({ status }: { status: CertificateListItem['status'] }) {
  const { color, label } = STATUS[status];
  return (
    <Tag color={color} data-testid="status-tag" style={{ marginInlineEnd: 0 }}>
      {label}
    </Tag>
  );
}
