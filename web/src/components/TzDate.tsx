import { formatInTenantTz, formatUtc } from '@cac/shared';
import { Tooltip } from 'antd';

/** A UTC instant shown in the tenant's timezone, with the raw UTC value on hover. */
export function TzDate({ utc, timeZone }: { utc: string; timeZone: string }) {
  return (
    <Tooltip title={formatUtc(utc)}>
      <time dateTime={utc}>{formatInTenantTz(utc, timeZone)}</time>
    </Tooltip>
  );
}
