import { expect, test, type Page, type Request } from '@playwright/test';

const alice = { id: 'alice', name: 'Alice Nguyen' };
const HHT = { id: 1, code: 'HHT', name: 'Harbour Health Training', timezone: 'Australia/Sydney' };
const course = {
  id: 1,
  title: 'Fire Safety 2026',
  enrolled: 16,
  counts: { eligible: 8, alreadyIssued: 3, notCompleted: 4, inactive: 1 },
};

// 16 learners: 8 issued, 3 already issued, 4 not completed, 1 inactive (failed).
type Final = { outcome: string; reason: string | null; certificateId: number | null; serial: string | null };
const issued = (n: number): Final => ({ outcome: 'issued', reason: null, certificateId: 500 + n, serial: `HHT-2026-00050${n}` });
const existing = (id: number): Final => ({ outcome: 'skipped', reason: 'already_issued', certificateId: id, serial: `HHT-2026-000${id}` });
const notCompleted: Final = { outcome: 'skipped', reason: 'not_completed', certificateId: null, serial: null };
const inactive: Final = { outcome: 'failed', reason: 'learner_inactive', certificateId: null, serial: null };
const FINAL: Array<[string, Final]> = [
  ['Ava Thompson', issued(1)], ['Chloe Davis', issued(2)], ['Ethan Brown', issued(3)], ['Grace Lee', issued(4)],
  ['Henry Clarke', existing(301)], ['Isla Young', inactive], ['Jack Taylor', issued(5)], ['Leo Walker', notCompleted],
  ['Liam Murphy', issued(6)], ['Lucas Nguyen', notCompleted], ['Mia Johnson', issued(7)], ['Noah Patel', issued(8)],
  ['Olivia Chen', existing(302)], ['Oscar White', notCompleted], ['Ruby Harris', notCompleted], ['Zoe Martin', existing(303)],
];

function runAt(processed: number, id = 77) {
  const items = FINAL.map(([learnerName, final], i) => ({
    learnerId: 1000 + i,
    learnerName,
    ...(i < processed ? final : { outcome: 'pending', reason: null, certificateId: null, serial: null }),
  }));
  const n = (o: string) => items.filter((it) => it.outcome === o).length;
  return {
    id,
    courseId: 1,
    courseTitle: course.title,
    status: processed >= items.length ? 'completed' : 'running',
    createdAt: '2026-04-04T14:30:00.000Z',
    createdBy: alice,
    total: items.length,
    processed,
    counts: { issued: n('issued'), skipped: n('skipped'), failed: n('failed'), pending: n('pending') },
    items,
  };
}

async function mockSession(page: Page) {
  await page.route('**/api/me', (route) => route.fulfill({ json: { admin: alice, tenants: [HHT] } }));
  await page.route(/\/api\/tenants\/\d+\/courses$/, (route) => route.fulfill({ json: { items: [course] } }));
}

/** Runs advance by `step` items per GET. Returns the request times of every GET. */
async function mockRuns(page: Page, step: number, start = 0) {
  let processed = start;
  const getTimes: number[] = [];
  await page.route(/\/api\/tenants\/\d+\/bulk-issue-runs\/\d+$/, (route) => {
    getTimes.push(Date.now());
    processed = Math.min(processed + step, FINAL.length);
    return route.fulfill({ json: { run: runAt(processed) } });
  });
  return getTimes;
}

const postUrl = /\/api\/tenants\/\d+\/courses\/\d+\/bulk-issue$/;

async function confirmIssue(page: Page) {
  await page.getByRole('button', { name: 'Issue 8 certificates' }).click();
  return page.getByRole('dialog').getByRole('button', { name: 'Issue certificates' });
}

test('a network failure is retried with the SAME Idempotency-Key and lands on the run page', async ({ page }) => {
  await mockSession(page);
  await mockRuns(page, 4);
  const posts: Request[] = [];
  await page.route(postUrl, (route) => {
    posts.push(route.request());
    if (posts.length === 1) return route.abort('failed');
    return route.fulfill({ status: 202, json: { run: runAt(0) } });
  });
  await page.goto('/t/1/bulk-issue?courseId=1');

  await (await confirmIssue(page)).click();

  await expect(page).toHaveURL(/\/t\/1\/bulk-issue\/runs\/77$/);
  await expect(page.getByRole('heading', { name: 'Fire Safety 2026' })).toBeVisible();
  expect(posts).toHaveLength(2);
  const keys = posts.map((r) => r.headers()['idempotency-key']);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
});

test('double-clicking OK sends exactly one POST', async ({ page }) => {
  await mockSession(page);
  await mockRuns(page, 4);
  const posts: Request[] = [];
  await page.route(postUrl, async (route) => {
    posts.push(route.request());
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ status: 202, json: { run: runAt(0) } });
  });
  await page.goto('/t/1/bulk-issue?courseId=1');

  await (await confirmIssue(page)).dblclick();

  await expect(page).toHaveURL(/\/t\/1\/bulk-issue\/runs\/77$/);
  expect(posts).toHaveLength(1);
});

test('a 422 shows the server message and keeps the user on the page', async ({ page }) => {
  await mockSession(page);
  await page.route(postUrl, (route) =>
    route.fulfill({
      status: 422,
      json: { error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Key was used for another course' } },
    }),
  );
  await page.goto('/t/1/bulk-issue?courseId=1');

  await (await confirmIssue(page)).click();

  await expect(page.getByText('Key was used for another course')).toBeVisible();
  await expect(page).toHaveURL(/\/t\/1\/bulk-issue\?courseId=1$/);
  await expect(page.getByRole('button', { name: 'Issue 8 certificates' })).toBeEnabled();
});

test('the run page polls every ~500 ms until completed, then shows counts and filters', async ({ page }) => {
  await mockSession(page);
  const getTimes = await mockRuns(page, 4);
  await page.goto('/t/1/bulk-issue/runs/77');

  await expect(page.getByText('Issuing…')).toBeVisible();
  await expect(page.getByText('Completed')).toBeVisible();
  await expect(page.getByTestId('run-progress')).toContainText('16 / 16');
  for (const [label, value] of [['Issued', '8'], ['Skipped', '7'], ['Failed', '1']]) {
    await expect(page.locator('.ant-statistic', { hasText: label }).locator('.ant-statistic-content-value')).toHaveText(value);
  }
  await expect(page.getByTestId('run-item-row')).toHaveCount(16);

  // Polling cadence: consecutive GETs at least ~400 ms apart, and it stops after completion.
  expect(getTimes).toHaveLength(4);
  for (let i = 1; i < getTimes.length; i++) expect(getTimes[i]! - getTimes[i - 1]!).toBeGreaterThanOrEqual(400);
  await page.waitForTimeout(1200);
  expect(getTimes).toHaveLength(4);

  await page.locator('.ant-segmented-item', { hasText: 'Failed' }).click();
  await expect(page.getByTestId('run-item-row')).toHaveCount(1);
  await expect(page.getByTestId('run-item-row')).toContainText('Learner account inactive');
});

test('reloading mid-run keeps following the same run', async ({ page }) => {
  await mockSession(page);
  await mockRuns(page, 2, 4);
  await page.goto('/t/1/bulk-issue/runs/77');
  await expect(page.getByText('Issuing…')).toBeVisible();

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Fire Safety 2026' })).toBeVisible();
  await expect(page.getByText('Completed')).toBeVisible({ timeout: 10_000 });
});

test('an unknown run shows the Not found page', async ({ page }) => {
  await mockSession(page);
  await page.route(/\/api\/tenants\/\d+\/bulk-issue-runs\/\d+$/, (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Run not found' } } }),
  );
  await page.goto('/t/1/bulk-issue/runs/999');

  await expect(page.getByText('Page not found')).toBeVisible();
});
