import { expect, test, type Page } from '@playwright/test';

const alice = { id: 'alice', name: 'Alice Nguyen' };
const HHT = { id: 1, code: 'HHT', name: 'Harbour Health Training', timezone: 'Australia/Sydney' };
const NHI = { id: 4, code: 'NHI', name: 'New Horizons Institute', timezone: 'Australia/Brisbane' };

const course = { id: 1, title: 'Fire Safety 2026', enrolled: 16, counts: { eligible: 8, alreadyIssued: 3, notCompleted: 4, inactive: 1 } };
const rows = [
  { id: 1, serial: 'HHT-2026-000001', learnerId: 10, learnerName: 'Emma Wilson', courseId: 1, courseTitle: course.title, issuedAt: '2026-04-04T14:30:00.000Z', status: 'valid' },
  { id: 2, serial: 'HHT-2026-000002', learnerId: 11, learnerName: 'Noah Patel', courseId: 1, courseTitle: course.title, issuedAt: '2026-03-01T01:00:00.000Z', status: 'revoked' },
  { id: 3, serial: 'HHT-2026-000003', learnerId: 12, learnerName: 'Olivia Chen', courseId: 1, courseTitle: course.title, issuedAt: '2026-02-01T01:00:00.000Z', status: 'valid' },
];

async function mockApp(page: Page, certificatesFor: (url: URL) => { status?: number; body: unknown }) {
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { admin: alice, tenants: [HHT, NHI] } }),
  );
  await page.route(/\/api\/tenants\/\d+\/courses$/, (route) =>
    route.fulfill({ json: { items: [course] } }),
  );
  const requests: URL[] = [];
  await page.route(/\/api\/tenants\/\d+\/certificates(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const { status = 200, body } = certificatesFor(url);
    return route.fulfill({ status, json: body });
  });
  return requests;
}

const listFor = (url: URL) => {
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const items = rows.filter((r) => !q || r.learnerName.toLowerCase().includes(q));
  return { body: { items, total: items.length, page: 1, pageSize: 20 } };
};

test('searching updates the URL and survives a reload', async ({ page }) => {
  const requests = await mockApp(page, listFor);
  await page.goto('/t/1/certificates');
  await expect(page.getByTestId('certificate-row')).toHaveCount(3);
  await expect(page.getByText('3 certificates')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search certificates' }).fill('emma');

  await expect(page).toHaveURL(/\/t\/1\/certificates\?q=emma$/);
  await expect(page.getByTestId('certificate-row')).toHaveCount(1);
  await expect(page.getByText('1 certificate', { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('q')).toBe('emma');

  await page.reload();

  await expect(page.getByRole('searchbox', { name: 'Search certificates' })).toHaveValue('emma');
  await expect(page.getByTestId('certificate-row')).toHaveCount(1);
  await expect(page.getByRole('row', { name: /Emma Wilson/ })).toContainText('5 Apr 2026, 1:30 am AEDT');
});

test('a 500 shows the error state and Retry recovers once the server is fixed', async ({ page }) => {
  let broken = true;
  await mockApp(page, (url) =>
    broken
      ? { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Database unavailable' } } }
      : listFor(url),
  );
  await page.goto('/t/1/certificates');

  await expect(page.getByRole('alert')).toContainText('Database unavailable');
  await expect(page.getByTestId('certificate-row')).toHaveCount(0);

  broken = false;
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByTestId('certificate-row')).toHaveCount(3);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a tenant without certificates shows the empty state with a bulk-issue button', async ({ page }) => {
  await mockApp(page, () => ({ body: { items: [], total: 0, page: 1, pageSize: 20 } }));
  await page.goto('/t/4/certificates');

  await expect(page.getByText('No certificates yet')).toBeVisible();
  await page.getByRole('button', { name: 'Bulk issue certificates' }).click();

  await expect(page).toHaveURL(/\/t\/4\/bulk-issue$/);
});

test('a search with no hits shows the filtered empty state and Clear filters restores the rows', async ({ page }) => {
  await mockApp(page, listFor);
  await page.goto('/t/1/certificates');
  await expect(page.getByTestId('certificate-row')).toHaveCount(3);

  await page.getByRole('searchbox', { name: 'Search certificates' }).fill('nobody');

  await expect(page.getByText('No certificates match your filters')).toBeVisible();
  await expect(page.getByText('No certificates yet')).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear filters' }).click();

  await expect(page).toHaveURL(/\/t\/1\/certificates$/);
  await expect(page.getByTestId('certificate-row')).toHaveCount(3);
  await expect(page.getByRole('searchbox', { name: 'Search certificates' })).toHaveValue('');
});
