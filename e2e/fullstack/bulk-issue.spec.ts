import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { bulkIssueRunResponseSchema, type BulkIssueRun } from '@cac/shared';
import { signInAs, switchTenant } from '../fixtures/session';

// Real frontend and real backend (APP_ENV=test, BULK_ISSUE_DELAY_MS=0, see playwright.config.ts).
const backend = `http://127.0.0.1:${process.env.PORT || 3001}`;

test.beforeEach(async ({ request }) => {
  const res = await request.post(`${backend}/api/__test__/reset`);
  expect(res.status()).toBe(204);
});

/** Statistic value next to an exact title, e.g. ("Eligible", "8"). */
const statValue = (page: Page, title: string) =>
  page
    .locator('.ant-statistic')
    .filter({ has: page.locator('.ant-statistic-title', { hasText: new RegExp(`^${title}$`) }) })
    .locator('.ant-statistic-content-value');

async function expectDistribution(page: Page, expected: Record<string, string>) {
  for (const [title, value] of Object.entries(expected)) await expect(statValue(page, title)).toHaveText(value);
}

async function pickCourse(page: Page, title: string) {
  await page.getByRole('combobox', { name: 'Course' }).click();
  await page.getByTitle(title).click();
}

async function expectRunResult(page: Page, issued: string, skipped: string, failed: string) {
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('run-progress')).toContainText('16 / 16');
  await expectDistribution(page, { Issued: issued, Skipped: skipped, Failed: failed });
}

const filterBy = (page: Page, label: string) => page.locator('.ant-segmented-item', { hasText: label }).click();

/** Signs in over HTTP on the API request context (its own cookie jar, separate from the browser). */
async function apiSignIn(request: APIRequestContext, adminId: string) {
  const res = await request.post(`${backend}/api/session`, { data: { adminId } });
  expect(res.status()).toBe(204);
}

/** Starts a run over HTTP and waits for it to complete; returns it. */
async function apiBulkIssue(request: APIRequestContext, tid: number, courseId: number): Promise<BulkIssueRun> {
  const res = await request.post(`${backend}/api/tenants/${tid}/courses/${courseId}/bulk-issue`, {
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(res.status()).toBe(202);
  const { id } = bulkIssueRunResponseSchema.parse(await res.json()).run;
  await expect
    .poll(async () => {
      const poll = await request.get(`${backend}/api/tenants/${tid}/bulk-issue-runs/${id}`);
      return bulkIssueRunResponseSchema.parse(await poll.json()).run.status;
    })
    .toBe('completed');
  const final = await request.get(`${backend}/api/tenants/${tid}/bulk-issue-runs/${id}`);
  return bulkIssueRunResponseSchema.parse(await final.json()).run;
}

async function signOutAndSignInAs(page: Page, adminName: string) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await signInAs(page, adminName);
}

test('alice issues Fire Safety 2026 from the UI and sees 8 issued / 7 skipped / 1 failed', async ({ page, request }) => {
  await page.goto('/');
  await signInAs(page, 'Alice Nguyen');
  await expect(page).toHaveURL(/\/t\/1\/certificates$/);

  await page.getByRole('link', { name: 'Bulk issue' }).click();
  await expect(page).toHaveURL(/\/t\/1\/bulk-issue$/);
  await pickCourse(page, 'Fire Safety 2026');
  await expectDistribution(page, { Eligible: '8', 'Already issued': '3', 'Not completed': '4', Inactive: '1' });

  await page.getByRole('button', { name: 'Issue 8 certificates' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue certificates' }).click();

  await expect(page).toHaveURL(/\/t\/1\/bulk-issue\/runs\/\d+$/);
  const runId = Number(page.url().match(/runs\/(\d+)$/)![1]);
  await expect(page.getByRole('heading', { name: 'Fire Safety 2026' })).toBeVisible();
  await expectRunResult(page, '8', '7', '1');

  await filterBy(page, 'Failed');
  await expect(page.getByTestId('run-item-row')).toHaveCount(1);
  await expect(page.getByTestId('run-item-row')).toContainText('Learner account inactive');

  // An issued row links to the certificate the server reports for that learner.
  await filterBy(page, 'Issued');
  await expect(page.getByTestId('run-item-row')).toHaveCount(8);
  const link = page.getByTestId('run-item-row').first().getByRole('link');
  await expect(link).toHaveText(/^HHT-2026-\d{6}$/);
  const learner = await page.getByTestId('run-item-row').first().locator('td').first().innerText();
  await apiSignIn(request, 'alice');
  const api = await request.get(`${backend}/api/tenants/1/bulk-issue-runs/${runId}`);
  const item = bulkIssueRunResponseSchema.parse(await api.json()).run.items.find((i) => i.learnerName === learner);
  expect(item?.outcome).toBe('issued');
  await expect(link).toHaveAttribute('href', `/t/1/certificates/${item!.certificateId}`);
});

test('reloading the run page shows the same final result', async ({ page, request }) => {
  await apiSignIn(request, 'alice');
  const run = await apiBulkIssue(request, 1, 101);
  await page.goto('/');
  await signInAs(page, 'Alice Nguyen');
  await page.goto(`/t/1/bulk-issue/runs/${run.id}`);
  await expectRunResult(page, '8', '7', '1');

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Fire Safety 2026' })).toBeVisible();
  await expectRunResult(page, '8', '7', '1');
  await expect(page.getByTestId('run-item-row')).toHaveCount(16);
});

test('after a run Fire Safety has nothing eligible and the list shows 53 certificates (11 for Fire Safety)', async ({ page, request }) => {
  await apiSignIn(request, 'alice');
  const run = await apiBulkIssue(request, 1, 101);
  await page.goto('/');
  await signInAs(page, 'Alice Nguyen');
  await page.goto(`/t/1/bulk-issue/runs/${run.id}`);

  await page.getByRole('button', { name: 'Back to bulk issue' }).click();

  await expect(page).toHaveURL(/\/t\/1\/bulk-issue\?courseId=101$/);
  await expectDistribution(page, { Eligible: '0', 'Already issued': '11', 'Not completed': '4', Inactive: '1' });
  await expect(page.getByRole('button', { name: 'Issue 0 certificates' })).toBeDisabled();
  await expect(page.getByText('Every enrolled learner already has a certificate or is not eligible.')).toBeVisible();

  await page.getByRole('link', { name: 'Certificates' }).click();
  await expect(page.getByText('53 certificates', { exact: true })).toBeVisible();
  await pickCourse(page, 'Fire Safety 2026');
  await expect(page.getByText('11 certificates', { exact: true })).toBeVisible();
});

test("carol opens alice's run and sees the same result, started by Alice Nguyen", async ({ page, request }) => {
  await apiSignIn(request, 'alice');
  const run = await apiBulkIssue(request, 1, 101);
  await page.goto('/');
  await signInAs(page, 'Carol Smith');

  await page.goto(`/t/1/bulk-issue/runs/${run.id}`);

  await expect(page.getByRole('heading', { name: 'Fire Safety 2026' })).toBeVisible();
  await expect(page.getByText('Started by Alice Nguyen')).toBeVisible();
  await expectRunResult(page, '8', '7', '1');
});

test("bob gets a 404 page for alice's run, and alice for LCL's bulk issue page", async ({ page, request }) => {
  await apiSignIn(request, 'alice');
  const run = await apiBulkIssue(request, 1, 101);
  await page.goto('/');
  await signInAs(page, 'Bob Fraser');

  await page.goto(`/t/1/bulk-issue/runs/${run.id}`);
  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.getByText('Fire Safety 2026')).toHaveCount(0);

  await signOutAndSignInAs(page, 'Alice Nguyen');
  await page.goto('/t/3/bulk-issue');
  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.getByText('Large Corp Learning')).toHaveCount(0);
});

test('NHI (Brisbane): issuing a course with eligible learners replaces the "No certificates yet" empty state', async ({ page }) => {
  await page.goto('/');
  await signInAs(page, 'Alice Nguyen');
  await switchTenant(page, 'New Horizons Institute');
  await expect(page).toHaveURL(/\/t\/4\/certificates$/);
  await expect(page.getByText('Australia/Brisbane')).toBeVisible();
  await expect(page.getByText('No certificates yet')).toBeVisible();

  await page.getByRole('link', { name: 'Bulk issue' }).click();
  await pickCourse(page, 'Mental Health First Aid');
  await expectDistribution(page, { Eligible: '3', 'Already issued': '0', 'Not completed': '2', Inactive: '0' });
  await page.getByRole('button', { name: 'Issue 3 certificates' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue certificates' }).click();
  await expect(page).toHaveURL(/\/t\/4\/bulk-issue\/runs\/\d+$/);
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expectDistribution(page, { Issued: '3', Skipped: '2', Failed: '0' });

  await page.getByRole('link', { name: 'Certificates' }).click();

  await expect(page.getByText('3 certificates', { exact: true })).toBeVisible();
  await expect(page.getByText('No certificates yet')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^NHI-\d{4}-\d{6}$/ })).toHaveCount(3);
});

test('double-clicking the confirm button against the real backend sends exactly one POST', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/bulk-issue$/.test(new URL(req.url()).pathname)) posts.push(req.url());
  });
  // Not a mock: the request still reaches the real backend, only delayed so the pending window is wide.
  await page.route(/\/bulk-issue$/, async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.continue();
  });
  await page.goto('/');
  await signInAs(page, 'Alice Nguyen');
  await page.goto('/t/1/bulk-issue?courseId=101');
  await page.getByRole('button', { name: 'Issue 8 certificates' }).click();

  await page.getByRole('dialog').getByRole('button', { name: 'Issue certificates' }).dblclick();

  await expect(page).toHaveURL(/\/t\/1\/bulk-issue\/runs\/\d+$/);
  await expectRunResult(page, '8', '7', '1');
  expect(posts).toHaveLength(1);
});
