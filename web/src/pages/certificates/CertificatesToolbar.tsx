import type { CertificateListQuery } from '@cac/shared';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Space } from 'antd';
import { useEffect, useState } from 'react';
import { coursesQuery } from '../../api/queries';

const SEARCH_DEBOUNCE_MS = 300;

const STATUS_OPTIONS = [
  { value: 'valid', label: 'Valid' },
  { value: 'revoked', label: 'Revoked' },
];

interface Props {
  tid: number;
  filters: CertificateListQuery;
  onChange: (patch: Partial<CertificateListQuery>) => void;
}

/** Search box (debounced into the URL), course filter and status filter. */
export function CertificatesToolbar({ tid, filters, onChange }: Props) {
  const courses = useQuery(coursesQuery(tid));
  const [text, setText] = useState(filters.q ?? '');
  const applied = text.trim() || undefined;

  // The URL changed from outside (Clear filters, back button, tenant switch): show it.
  useEffect(() => {
    setText((current) => ((current.trim() || undefined) === filters.q ? current : (filters.q ?? '')));
  }, [filters.q]);

  // Typed text reaches the URL only after the user pauses.
  useEffect(() => {
    if (applied === filters.q) return;
    const timer = setTimeout(() => onChange({ q: applied }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Only a change to the typed text should (re)start the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  return (
    <Space wrap size="middle" style={{ marginBottom: 16 }}>
      <Input.Search
        aria-label="Search certificates"
        placeholder="Search learner or serial"
        allowClear
        style={{ width: 280 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onSearch={(value) => onChange({ q: value.trim() || undefined })}
      />
      <Select
        aria-label="Course"
        placeholder="Course"
        allowClear
        loading={courses.isPending}
        style={{ width: 240 }}
        value={filters.courseId}
        options={courses.data?.items.map((c) => ({ value: c.id, label: c.title }))}
        onChange={(value: number | undefined) => onChange({ courseId: value })}
      />
      <Select
        aria-label="Status"
        placeholder="Status"
        allowClear
        style={{ width: 140 }}
        value={filters.status}
        options={STATUS_OPTIONS}
        onChange={(value: 'valid' | 'revoked' | undefined) => onChange({ status: value })}
      />
    </Space>
  );
}
