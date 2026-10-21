import type { CertificateListItem, CertificateListQuery } from '@cac/shared';
import { Table, type TableProps } from 'antd';
import type { HTMLAttributes } from 'react';
import { Link } from 'react-router';
import { StatusTag } from '../../components/StatusTag';
import { TzDate } from '../../components/TzDate';

type SortKey = CertificateListQuery['sort'];

interface Props {
  tid: number;
  timeZone: string;
  items: CertificateListItem[];
  total: number;
  filters: CertificateListQuery;
  loading: boolean;
  onChange: (patch: Partial<CertificateListQuery>) => void;
}

const SORT_KEYS: SortKey[] = ['issuedAt', 'learnerName', 'courseTitle', 'serial'];

/** Server-side paginated and sorted certificate table; all state comes from `filters`. */
export function CertificatesTable({ tid, timeZone, items, total, filters, loading, onChange }: Props) {
  const sortOrder = (key: SortKey) =>
    filters.sort === key ? (filters.order === 'asc' ? ('ascend' as const) : ('descend' as const)) : null;

  const columns: TableProps<CertificateListItem>['columns'] = [
    {
      title: 'Serial',
      dataIndex: 'serial',
      key: 'serial',
      sorter: true,
      sortOrder: sortOrder('serial'),
      render: (serial: string, row) => <Link to={`/t/${tid}/certificates/${row.id}`}>{serial}</Link>,
    },
    { title: 'Learner', dataIndex: 'learnerName', key: 'learnerName', sorter: true, sortOrder: sortOrder('learnerName') },
    { title: 'Course', dataIndex: 'courseTitle', key: 'courseTitle', sorter: true, sortOrder: sortOrder('courseTitle') },
    {
      title: 'Issued',
      dataIndex: 'issuedAt',
      key: 'issuedAt',
      sorter: true,
      sortOrder: sortOrder('issuedAt'),
      render: (issuedAt: string) => <TzDate utc={issuedAt} timeZone={timeZone} />,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: CertificateListItem['status']) => <StatusTag status={status} />,
    },
  ];

  const handleChange: TableProps<CertificateListItem>['onChange'] = (pagination, _f, sorter, extra) => {
    if (extra.action === 'paginate') {
      if (pagination.pageSize !== filters.pageSize) onChange({ pageSize: pagination.pageSize });
      else onChange({ page: pagination.current });
      return;
    }
    if (extra.action !== 'sort' || Array.isArray(sorter)) return;
    const key = SORT_KEYS.find((k) => k === sorter.columnKey);
    if (!key) return;
    // Clicking the third time cancels the sort in antd; keep it a two-state toggle instead.
    const order = sorter.order
      ? sorter.order === 'ascend' ? 'asc' : 'desc'
      : filters.order === 'asc' ? 'desc' : 'asc';
    onChange({ sort: key, order, page: 1 });
  };

  return (
    <Table<CertificateListItem>
      size="middle"
      rowKey="id"
      columns={columns}
      dataSource={items}
      loading={loading}
      onChange={handleChange}
      onRow={() => ({ 'data-testid': 'certificate-row' }) as HTMLAttributes<HTMLElement>}
      showSorterTooltip={false}
      pagination={{
        current: filters.page,
        pageSize: filters.pageSize,
        total,
        pageSizeOptions: [20, 50, 100],
        showSizeChanger: true,
        showTotal: (n) => `${n} total`,
      }}
    />
  );
}
