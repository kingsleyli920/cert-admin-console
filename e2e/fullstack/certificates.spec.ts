import { expect, test, type Page } from '@playwright/test';
import { certificateListResponseSchema, type CertificateListItem } from '@cac/shared';
import { signInAs, switchTenant, tenantSwitcherOptions } from '../fixtures/session';

// Real frontend and real backend (APP_ENV=test, see playwright.config.ts); nothing is mocked.
const backend = `http://127.0.0.1:${process.env.PORT || 3001}`;

test.beforeEach(async ({ request }) => {
  const res = await request.post(`${backend}/api/__test__/reset`);
  expect(res.status()).toBe(204);
});

const rows = (page: Page) => page.getByTestId('certificate-row');
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search certificates' });

async function openAs(page: Page, adminName: string): Promise<void> {
  await page.goto('/');
  await signInAs(page, adminName);
  await expect(page).toHaveURL(/\/t\/\d+\/certificates$/);
}

/** Reads a tenant's full certificate list through the page's (signed-in) API session. */
async function apiCertificates(page: Page, tid: number): Promise<CertificateListItem[]> {
  const res = await page.request.get(`${backend}/api/tenants/${tid}/certificates?pageSize=100`);
  expect(res.status()).toBe(200);
  return certificateListResponseSchema.parse(await res.json()).items;
}

test('alice in HHT sees 45 certificates, 20 per page', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await expect(page.getByText('45 certificates')).toBeVisible();
  await expect(rows(page)).toHaveCount(20);
});

test('searching a learner filters the rows, writes q to the URL and survives a reload', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await search(page).fill('Emma Wilson');

  await expect(page).toHaveURL(/[?&]q=Emma(\+|%20)Wilson/);
  await expect(page.getByText('45 certificates')).toHaveCount(0);
  const count = await rows(page).count();
  expect(count).toBeGreaterThan(0);
  await expect(rows(page).filter({ hasText: 'Emma Wilson' })).toHaveCount(count);

  await page.reload();

  await expect(search(page)).toHaveValue('Emma Wilson');
  await expect(rows(page)).toHaveCount(count);
  await expect(rows(page).filter({ hasText: 'Emma Wilson' })).toHaveCount(count);
});

test('Clear filters after a search with no hits restores all 45 certificates', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await search(page).fill('zzzz');
  await expect(page.getByText('No certificates match your filters')).toBeVisible();

  await page.getByRole('button', { name: 'Clear filters' }).click();

  await expect(page.getByText('45 certificates')).toBeVisible();
  await expect(search(page)).toHaveValue('');
  await expect(page).not.toHaveURL(/q=/);
});

test('the DST-edge certificate shows Sydney time in HHT and Perth time in SRA', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');
  const hhtEdge = (await apiCertificates(page, 1)).find((c) => c.id === 45);
  const sraEdge = (await apiCertificates(page, 2)).find((c) => c.id === 115);
  expect(hhtEdge?.serial).toBe('HHT-2026-000037');
  expect(sraEdge?.serial).toMatch(/^SRA-/);

  await search(page).fill(hhtEdge!.serial);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('5 Apr 2026, 1:30 am AEDT');

  await switchTenant(page, 'Swan River Academy');
  // Wait for SRA's own list before typing: the switch resets the search box once it renders.
  await expect(page.getByText('15 certificates')).toBeVisible();
  await expect(search(page)).toHaveValue('');
  await search(page).fill(sraEdge!.serial);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('4 Apr 2026, 10:30 pm AWST');
});

test('sorting by Learner toggles asc and desc and paging reaches the last 5 rows', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');
  const firstLearner = async () => (await rows(page).first().getByRole('cell').nth(1).innerText()).trim();
  const header = page.getByRole('columnheader', { name: 'Learner' });

  await header.click();
  await expect(page).toHaveURL(/sort=learnerName/);
  await expect(page).toHaveURL(/order=asc/);
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const asc = await firstLearner();

  await header.click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(firstLearner).not.toBe(asc);

  await page.getByTitle('3', { exact: true }).click();

  await expect(page).toHaveURL(/page=3/);
  await expect(rows(page)).toHaveCount(5);
});

test('the Revoked status filter shows the 3 seeded revoked HHT certificates with red tags', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByTitle('Revoked', { exact: true }).click();

  await expect(rows(page)).toHaveCount(3);
  const tags = rows(page).getByTestId('status-tag');
  await expect(tags).toHaveText(['Revoked', 'Revoked', 'Revoked']);
  for (const tag of await tags.all()) await expect(tag).toHaveClass(/ant-tag-red/);

});

test('the Fire Safety 2026 course filter shows its 3 certificates', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await page.getByRole('combobox', { name: 'Course' }).click();
  await page.getByTitle('Fire Safety 2026', { exact: true }).click();

  await expect(page).toHaveURL(/courseId=101/);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).filter({ hasText: 'Fire Safety 2026' })).toHaveCount(3);
});

test('NHI has no certificates yet and the empty state leads to bulk issue', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await switchTenant(page, 'New Horizons Institute');

  await expect(page.getByText('No certificates yet')).toBeVisible();
  await page.getByRole('button', { name: 'Bulk issue certificates' }).click();
  await expect(page).toHaveURL(/\/t\/4\/bulk-issue$/);
});

test('bob pages through the 8000 LCL certificates at 100 per page, up to the last page', async ({ page }) => {
  await openAs(page, 'Bob Fraser');
  await expect(page).toHaveURL(/\/t\/3\/certificates$/);
  await expect(page.getByText('8000 certificates')).toBeVisible();
  await expect(rows(page)).toHaveCount(20);

  await page.locator('.ant-pagination-options .ant-select').click();
  await page.getByTitle('100 / page').click();
  await expect(page).toHaveURL(/pageSize=100/);
  await expect(rows(page)).toHaveCount(100);

  await page.getByTitle('80', { exact: true }).click();

  await expect(page).toHaveURL(/page=80/);
  await expect(rows(page)).toHaveCount(100);
  await expect(page.getByText('8000 certificates')).toBeVisible();
});

test("bob opening alice's HHT URL sees the 404 page and no HHT data", async ({ page }) => {
  await openAs(page, 'Bob Fraser');

  await page.goto('/t/1/certificates');

  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText(/HHT-/)).toHaveCount(0);
  await expect(page.getByText('Harbour Health Training')).toHaveCount(0);
});

test('carol sees the 45 HHT certificates and no other tenant', async ({ page }) => {
  await openAs(page, 'Carol Smith');

  await expect(page.getByText('45 certificates')).toBeVisible();
  expect(await tenantSwitcherOptions(page)).toEqual(['Harbour Health Training']);
});

test('switching from HHT to SRA never renders an HHT serial under SRA', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');
  await expect(rows(page)).toHaveCount(20);

  // Record any DOM state that already shows SRA's timezone label while an HHT serial is still
  // listed. (The URL changes a moment before React re-renders, so the URL alone proves nothing.)
  // String form: the e2e tsconfig has no DOM lib.
  await page.evaluate(`
    window.__staleHht = false;
    new MutationObserver(() => {
      const text = document.body.innerText;
      if (text.includes('Australia/Perth') && text.includes('HHT-')) window.__staleHht = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  `);

  await switchTenant(page, 'Swan River Academy');

  await expect(page.getByText('15 certificates')).toBeVisible();
  await expect(page.getByText(/HHT-/)).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'SRA-' })).toHaveCount(15);
  expect(await page.evaluate('window.__staleHht')).toBe(false);
});
