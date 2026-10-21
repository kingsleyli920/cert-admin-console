import type { AuditEntry } from '@cac/shared';
import { Timeline, Typography } from 'antd';
import { Link } from 'react-router';
import { TzDate } from '../../components/TzDate';

interface Props {
  tid: number;
  timeZone: string;
  /** Oldest first, as the server returns it. */
  entries: AuditEntry[];
}

const ACTION = {
  ISSUE: { verb: 'Issued', color: 'green' },
  REVOKE: { verb: 'Revoked', color: 'red' },
} as const;

/** The certificate's issue / revoke history; each entry says who did what and when. */
export function AuditTrail({ tid, timeZone, entries }: Props) {
  return (
    <section aria-labelledby="audit-trail-title">
      <Typography.Title level={3} id="audit-trail-title" style={{ fontSize: 16 }}>
        Audit trail
      </Typography.Title>
      <Timeline
        items={entries.map((entry) => ({
          key: entry.id,
          color: ACTION[entry.action].color,
          content: (
            <div data-testid="audit-entry">
              <div>
                <Typography.Text strong>
                  {ACTION[entry.action].verb} by {entry.actor.name}
                </Typography.Text>
                {entry.action === 'ISSUE' && entry.runId !== null && (
                  <>
                    {' · '}
                    <Link to={`/t/${tid}/bulk-issue/runs/${entry.runId}`}>bulk issue run</Link>
                  </>
                )}
              </div>
              <Typography.Text type="secondary">
                <TzDate utc={entry.createdAt} timeZone={timeZone} />
              </Typography.Text>
            </div>
          ),
        }))}
      />
    </section>
  );
}
