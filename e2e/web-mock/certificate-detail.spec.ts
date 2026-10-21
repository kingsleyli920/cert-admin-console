import { expect, test, type Page } from '@playwright/test';

const alice = { id: 'alice', name: 'Alice Nguyen' };
const HHT = { id: 1, code: 'HHT', name: 'Harbour Health Training', timezone: 'Australia/Sydney' };
const COURSE = 'Fire Safety 2026';
const ISSUED_AT = '2026-04-04T14:30:00.000Z'; // Sydney: 5 Apr 2026, 1:30 am AEDT

type Detail = {
  id: number;
  serial: string;
  learnerId: number;
  learnerName: string;
  courseId: number;
  courseTitle: string;
  issuedAt: string;
  status: 'valid' | 'revoked';
  issuedBy: typeof alice;
  revokedAt: string | null;
  revokedBy: typeof alice | null;
  revokeReason: string | null;
  audit: Array<Record<string, unknown>>;
};

function validCertificate(): Detail {
  return {
    id: 1,
    serial: 'HHT-2026-000001',
    learnerId: 10,
    learnerName: 'Emma Wilson',
    courseId: 1,
    courseTitle: COURSE,
    issuedAt: ISSUED_AT,
    status: 'valid',
    issuedBy: alice,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    audit: [
      { id: 1, action: 'ISSUE', actor: alice, createdAt: ISSUED_AT, certificateId: 1, courseId: 1, learnerId: 10, runId: 77 },
    ],
  };
}

/** Serves `me`, courses, the list and the detail/revoke routes from one in-memory certificate. */
async function mockApp(page: Page) {
  const cert = validCertificate();
  const revokes: unknown[] = [];
  await page.route('**/api/me', (route) => route.fulfill({ json: { admin: alice, tenants: [HHT] } }));
  await page.route(/\/api\/tenants\/\d+\/courses$/, (route) => route.fulfill({ json: { items: [] } }));
  await page.route(/\/api\/tenants\/1\/certificates(\?.*)?$/, (route) => {
    const { id, serial, learnerId, learnerName, courseId, courseTitle, issuedAt, status } = cert;
    const item = { id, serial, learnerId, learnerName, courseId, courseTitle, issuedAt, status };
    return route.fulfill({ json: { items: [item], total: 1, page: 1, pageSize: 20 } });
  });
  await page.route(/\/api\/tenants\/\d+\/certificates\/\d+$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    const tenant = Number(new URL(route.request().url()).pathname.split('/')[3]);
    return id === cert.id && tenant === 1
      ? route.fulfill({ json: cert })
      : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
  });
  await page.route(/\/api\/tenants\/1\/certificates\/1\/revoke$/, (route) => {
    const body = route.request().postDataJSON() as { reason: string };
    revokes.push(body);
    const at = '2026-04-07T01:00:00.000Z';
    cert.status = 'revoked';
    cert.revokedAt = at;
    cert.revokedBy = alice;
    cert.revokeReason = body.reason;
    cert.audit.push({ id: 2, action: 'REVOKE', actor: alice, createdAt: at, certificateId: 1, courseId: 1, learnerId: 10, runId: null });
    return route.fulfill({ json: cert });
  });
  return { revokes };
}

test('opens a certificate from the list, revokes it with a reason and sees the new audit entry', async ({ page }) => {
  const { revokes } = await mockApp(page);
  await page.goto('/t/1/certificates?q=emma');
  await page.getByRole('link', { name: 'HHT-2026-000001' }).click();

  await expect(page).toHaveURL(/\/t\/1\/certificates\/1$/);
  await expect(page.getByRole('heading', { level: 2, name: /HHT-2026-000001/ })).toBeVisible();
  const fields = page.locator('.ant-descriptions');
  await expect(fields.getByText('5 Apr 2026, 1:30 am AEDT')).toBeVisible();
  await expect(fields.getByText('Australia/Sydney')).toBeVisible();
  await expect(page.getByTestId('audit-entry')).toHaveCount(1);
  await expect(page.getByTestId('audit-entry')).toContainText('Issued by Alice Nguyen');
  await expect(page.getByRole('link', { name: 'bulk issue run' })).toHaveAttribute('href', '/t/1/bulk-issue/runs/77');

  await page.getByRole('button', { name: 'Revoke certificate' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Revoke certificate HHT-2026-000001?');

  // An empty reason is refused before anything is sent.
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(dialog.getByText('Enter a reason for revoking this certificate')).toBeVisible();
  expect(revokes).toEqual([]);

  await dialog.getByRole('textbox', { name: 'Reason' }).fill('  Issued to the wrong learner ');
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();

  await expect(page.getByText('Certificate revoked')).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(revokes).toEqual([{ reason: 'Issued to the wrong learner' }]);
  await expect(page.getByTestId('status-tag').first()).toHaveText('Revoked');
  await expect(page.getByRole('button', { name: 'Revoke certificate' })).toHaveCount(0);
  await expect(page.getByTestId('audit-entry')).toHaveCount(2);
  await expect(page.getByTestId('audit-entry').last()).toContainText('Revoked by Alice Nguyen');
  await expect(fields.getByText('Issued to the wrong learner')).toBeVisible();

  // Back to the list keeps the query and shows the new status.
  await page.getByRole('link', { name: '← Certificates' }).click();
  await expect(page).toHaveURL(/\/t\/1\/certificates\?q=emma$/);
  await expect(page.getByTestId('certificate-row').getByTestId('status-tag')).toHaveText('Revoked');
});

test('a certificate that is not in this tenant shows the not-found page', async ({ page }) => {
  await mockApp(page);
  await page.goto('/t/1/certificates/999');

  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.getByTestId('status-tag')).toHaveCount(0);
});
