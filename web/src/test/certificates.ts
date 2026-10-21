import type { CertificateListItem, CourseSummary } from '@cac/shared';
import { http, HttpResponse } from 'msw';
import { server } from './msw';

/** The DST-edge instant from the seed: Sydney 5 Apr 2026 1:30 am AEDT, Perth 4 Apr 2026 10:30 pm AWST. */
export const DST_EDGE = '2026-04-04T14:30:00.000Z';

const course = (id: number, title: string, enrolled = 20): CourseSummary => ({
  id,
  title,
  enrolled,
  counts: { eligible: 5, alreadyIssued: 10, notCompleted: 4, inactive: 1 },
});

export const hhtCourses = [
  course(1, 'Fire Safety 2026', 16),
  course(2, 'First Aid Essentials'),
  course(3, 'Manual Handling'),
];
export const sraCourses = [course(4, 'Working at Heights'), course(5, 'Remote Area First Aid')];
export const nhiCourses = [course(6, 'Infection Control')];

const NAMES = [
  'Noah Patel', 'Olivia Chen', 'Liam Murphy', 'Ava Thompson', 'Lucas Nguyen',
  'Mia Johnson', 'Ethan Brown', 'Chloe Davis', 'Jack Taylor', 'Grace Lee',
  'Henry Clarke', 'Zoe Martin', 'Oscar White', 'Ruby Harris', 'Leo Walker',
  'Isla Young', 'Archie King', 'Willow Scott', 'Max Green', 'Ivy Baker',
  'Sam Turner', 'Ella Hughes', 'Finn Cooper', 'Lily Ward',
];

function build(
  code: string,
  idStart: number,
  courses: CourseSummary[],
  count: number,
  edge: { id: number; learnerId: number },
): CertificateListItem[] {
  const rows: CertificateListItem[] = [];
  const edgeCourse = courses[0]!;
  rows.push({
    id: edge.id,
    serial: `${code}-2026-${String(edge.id).padStart(6, '0')}`,
    learnerId: edge.learnerId,
    learnerName: 'Emma Wilson',
    courseId: edgeCourse.id,
    courseTitle: edgeCourse.title,
    issuedAt: DST_EDGE,
    status: 'valid',
  });
  for (let i = 1; i < count; i++) {
    const id = idStart + i;
    const c = courses[i % courses.length]!;
    rows.push({
      id,
      serial: `${code}-2026-${String(id).padStart(6, '0')}`,
      learnerId: edge.learnerId + i,
      learnerName: NAMES[(i - 1) % NAMES.length]!,
      courseId: c.id,
      courseTitle: c.title,
      // One certificate per day, newest last; none collides with the edge instant.
      issuedAt: new Date(Date.UTC(2026, 0, 1 + i, 3, 0, 0)).toISOString(),
      status: i % 6 === 0 ? 'revoked' : 'valid',
    });
  }
  return rows;
}

/** 25 rows: the DST-edge Emma Wilson plus 24 others (4 revoked). */
export const hhtCertificates = build('HHT', 100, hhtCourses, 25, { id: 100, learnerId: 1000 });
/** 5 rows including SRA's own Emma Wilson at the same UTC instant. */
export const sraCertificates = build('SRA', 200, sraCourses, 5, { id: 200, learnerId: 2000 });

const tenantData: Record<number, { courses: CourseSummary[]; certificates: CertificateListItem[] }> = {
  1: { courses: hhtCourses, certificates: hhtCertificates },
  2: { courses: sraCourses, certificates: sraCertificates },
  4: { courses: nhiCourses, certificates: [] },
};

type SortKey = 'issuedAt' | 'learnerName' | 'courseTitle' | 'serial';

/** Applies the list endpoint's rules (spec 1.4) to an in-memory table. */
export function queryCertificates(rows: CertificateListItem[], sp: URLSearchParams) {
  const q = (sp.get('q') ?? '').trim().toLowerCase();
  const courseId = sp.get('courseId');
  const status = sp.get('status');
  const sort = (sp.get('sort') ?? 'issuedAt') as SortKey;
  const dir = (sp.get('order') ?? 'desc') === 'asc' ? 1 : -1;
  const page = Number(sp.get('page') ?? 1);
  const pageSize = Number(sp.get('pageSize') ?? 20);

  const filtered = rows
    .filter(
      (r) =>
        (!q || r.learnerName.toLowerCase().includes(q) || r.serial.toLowerCase().startsWith(q)) &&
        (!courseId || r.courseId === Number(courseId)) &&
        (!status || r.status === status),
    )
    .sort((a, b) => (a[sort] < b[sort] ? -dir : a[sort] > b[sort] ? dir : a.id - b.id));
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}

export interface CertificatesBackend {
  /** Query string of every list request, in order. */
  requests: URLSearchParams[];
  /** Number of `/courses` requests. */
  courseRequests: number;
  /** While set, list requests fail with a 500 carrying this message. */
  failWith?: string;
}

/** MSW handlers for the list and courses endpoints of HHT (1), SRA (2) and NHI (4, empty). */
export function mockCertificatesBackend(
  opts: { delayMs?: Partial<Record<number, number>> } = {},
): CertificatesBackend {
  const backend: CertificatesBackend = { requests: [], courseRequests: 0 };
  server.use(
    http.get('/api/tenants/:tid/certificates', async ({ request, params }) => {
      const tid = Number(params.tid);
      backend.requests.push(new URL(request.url).searchParams);
      const delay = opts.delayMs?.[tid];
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (backend.failWith) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: backend.failWith } },
          { status: 500 },
        );
      }
      const data = tenantData[tid];
      if (!data) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
      return HttpResponse.json(queryCertificates(data.certificates, new URL(request.url).searchParams));
    }),
    http.get('/api/tenants/:tid/courses', ({ params }) => {
      backend.courseRequests++;
      return HttpResponse.json({ items: tenantData[Number(params.tid)]?.courses ?? [] });
    }),
  );
  return backend;
}
