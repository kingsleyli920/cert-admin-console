import { expect, test, type Page } from '@playwright/test';
import { signInAs, switchTenant } from '../fixtures/session';

// Real frontend and real backend (APP_ENV=test, see playwright.config.ts); nothing is mocked.
const backend = `http://127.0.0.1:${process.env.PORT || 3001}`;

test.beforeEach(async ({ request }) => {
  const res = await request.post(`${backend}/api/__test__/reset`);
  expect(res.status()).toBe(204);
});

const rows = (page: Page) => page.getByTestId('certificate-row');
const auditEntries = (page: Page) => page.getByTestId('audit-entry');
const revokeButton = (page: Page) => page.getByRole('button', { name: 'Revoke certificate' });

async function openAs(page: Page, adminName: string): Promise<void> {
  await page.goto('/');
  await signInAs(page, adminName);
  await expect(page).toHaveURL(/\/t\/\d+\/certificates$/);
}

/** The value cell next to a label of the detail page's description list. */
const field = (page: Page, label: string) =>
  page
    .locator('th.ant-descriptions-item-label')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::td[1]');

test('alice opens the HHT DST-edge certificate from the list: Sydney time, UTC on hover, issued by Alice', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');
  await page.getByRole('searchbox', { name: 'Search certificates' }).fill('HHT-2026-000037');
  await expect(rows(page)).toHaveCount(1);

  await rows(page).first().getByRole('link', { name: 'HHT-2026-000037' }).click();

  await expect(page).toHaveURL(/\/t\/1\/certificates\/45$/);
  await expect(page.getByRole('heading', { name: 'HHT-2026-000037' })).toBeVisible();
  const issued = field(page, 'Issued');
  await expect(issued).toContainText('5 Apr 2026, 1:30 am AEDT');
  await expect(issued).toContainText('Australia/Sydney');
  await issued.locator('time').hover();
  await expect(page.getByRole('tooltip')).toHaveText('2026-04-04 14:30 UTC');
  await expect(auditEntries(page)).toHaveCount(1);
  await expect(auditEntries(page).first()).toContainText('Issued by Alice Nguyen');
});

test('alice switches to SRA and opens its DST-edge certificate: the same instant in Perth time', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');
  await switchTenant(page, 'Swan River Academy');
  await expect(page.getByText('15 certificates')).toBeVisible();

  await rows(page).filter({ hasText: '4 Apr 2026, 10:30 pm AWST' }).getByRole('link').click();

  await expect(page).toHaveURL(/\/t\/2\/certificates\/115$/);
  const issued = field(page, 'Issued');
  await expect(issued).toContainText('4 Apr 2026, 10:30 pm AWST');
  await expect(issued).toContainText('Australia/Perth');
  await issued.locator('time').hover();
  await expect(page.getByRole('tooltip')).toHaveText('2026-04-04 14:30 UTC');
});

test("carol revokes alice's certificate: revoke info, both actors in the audit trail, 4 revoked in the list", async ({ page }) => {
  await openAs(page, 'Carol Smith');
  await page.goto('/t/1/certificates/1');
  await expect(auditEntries(page)).toHaveText([/Issued by Alice Nguyen/]);
  const serial = (await page.getByRole('heading', { level: 2 }).innerText()).trim();

  await revokeButton(page).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('Duplicate record');
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('status-tag').first()).toHaveText('Revoked');
  await expect(field(page, 'Revoked by')).toContainText('Carol Smith');
  await expect(field(page, 'Reason')).toContainText('Duplicate record');
  await expect(revokeButton(page)).toHaveCount(0);
  await expect(auditEntries(page)).toHaveText([/Issued by Alice Nguyen/, /Revoked by Carol Smith/]);

  await page.getByRole('link', { name: '← Certificates' }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByTitle('Revoked', { exact: true }).click();

  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).filter({ hasText: serial })).toHaveCount(1);
});

test('an already revoked certificate has no Revoke button', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await page.goto('/t/1/certificates/3');

  await expect(page.getByTestId('status-tag').first()).toHaveText('Revoked');
  await expect(field(page, 'Reason')).toContainText('Issued against superseded course version');
  await expect(revokeButton(page)).toHaveCount(0);
});

test('submitting an empty reason keeps the dialog open with a message and sends no POST', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/revoke')) posts.push(req.url());
  });
  await openAs(page, 'Alice Nguyen');
  await page.goto('/t/1/certificates/1');

  await revokeButton(page).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();

  await expect(dialog.getByText('Enter a reason for revoking this certificate')).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(posts).toEqual([]);
  // The backend agrees nothing changed.
  const res = await page.request.get(`${backend}/api/tenants/1/certificates/1`);
  expect((await res.json()).status).toBe('valid');
});

test("bob opening HHT's certificate 45 sees the 404 page and no certificate data", async ({ page }) => {
  await openAs(page, 'Bob Fraser');

  await page.goto('/t/1/certificates/45');

  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.getByText('HHT-2026-000037')).toHaveCount(0);
  await expect(revokeButton(page)).toHaveCount(0);
  await expect(auditEntries(page)).toHaveCount(0);
});

test("alice opening SRA's certificate 115 through the HHT URL sees the 404 page and no certificate data", async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await page.goto('/t/1/certificates/115');

  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.getByText(/SRA-/)).toHaveCount(0);
  await expect(page.getByText('AWST')).toHaveCount(0);
  await expect(revokeButton(page)).toHaveCount(0);
});

test('a revoked Fire Safety certificate is skipped as revoked by the next bulk issue and links back to it', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');
  await page.goto('/t/1/certificates/1');
  const learner = (await field(page, 'Learner').innerText()).trim();
  await expect(field(page, 'Course')).toContainText('Fire Safety 2026');
  await revokeButton(page).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('Issued in error');
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('status-tag').first()).toHaveText('Revoked');

  await page.getByRole('link', { name: 'Bulk issue' }).click();
  await page.getByRole('combobox', { name: 'Course' }).click();
  await page.getByTitle('Fire Safety 2026').click();
  await page.getByRole('button', { name: 'Issue 8 certificates' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue certificates' }).click();

  await expect(page).toHaveURL(/\/t\/1\/bulk-issue\/runs\/\d+$/);
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await page.locator('.ant-segmented-item', { hasText: 'Skipped' }).click();
  const item = page.getByTestId('run-item-row').filter({ hasText: learner }).filter({ hasText: 'Certificate was revoked' });
  await expect(item).toHaveCount(1);
  await expect(item.getByRole('link')).toHaveAttribute('href', '/t/1/certificates/1');
  await item.getByRole('link').click();
  await expect(page).toHaveURL(/\/t\/1\/certificates\/1$/);
  await expect(page.getByTestId('status-tag').first()).toHaveText('Revoked');
});
