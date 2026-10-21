import { expect, test } from '@playwright/test';
import { signInAs, switchTenant } from '../fixtures/session';

// Visual baselines against the real backend with the deterministic seed (SPEC §3.1).
const backend = `http://127.0.0.1:${process.env.PORT || 3001}`;

test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${backend}/api/__test__/reset`)).status()).toBe(204);
  await page.clock.setFixedTime(new Date('2026-10-20T01:00:00.000Z'));
  await page.goto('/sign-in');
  await signInAs(page, 'Alice Nguyen');
  await expect(page.getByText('45 certificates')).toBeVisible();
});

test('certificate list (HHT, Sydney)', async ({ page }) => {
  await expect(page).toHaveScreenshot('list-hht.png', { animations: 'disabled' });
});

test('no certificates yet (NHI, Brisbane)', async ({ page }) => {
  await switchTenant(page, 'New Horizons Institute');
  await expect(page.getByText('No certificates yet')).toBeVisible();
  await expect(page).toHaveScreenshot('list-empty-tenant.png', { animations: 'disabled' });
});

test('no certificates match the filters', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Search certificates' }).fill('zzzz');
  await expect(page.getByText('No certificates match your filters')).toBeVisible();
  await expect(page).toHaveScreenshot('list-no-match.png', { animations: 'disabled' });
});
