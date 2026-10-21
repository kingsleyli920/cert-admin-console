import { expect, test } from '@playwright/test';
import { signInAs, switchTenant, tenantSwitcherOptions } from '../fixtures/session';

// Real frontend and real backend (APP_ENV=test, see playwright.config.ts); nothing is mocked.
const backend = `http://127.0.0.1:${process.env.PORT || 3001}`;

test.beforeEach(async ({ request }) => {
  const res = await request.post(`${backend}/api/__test__/reset`);
  expect(res.status()).toBe(204);
});

test('anonymous visitors are sent to sign-in from a tenant URL', async ({ page }) => {
  await page.goto('/t/1/certificates');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('radio', { name: 'Carol Smith' })).toBeVisible();
});

test('alice, bob and carol each get their own tenants, timezones and 404s', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);

  // alice: HHT first, then SRA; the switcher lists exactly her three tenants.
  await signInAs(page, 'Alice Nguyen');
  await expect(page).toHaveURL(/\/t\/1\/certificates$/);
  await expect(page.getByText('Australia/Sydney')).toBeVisible();
  await expect(page.getByText('Alice Nguyen')).toBeVisible();
  expect(await tenantSwitcherOptions(page)).toEqual([
    'Harbour Health Training',
    'Swan River Academy',
    'New Horizons Institute',
  ]);

  await switchTenant(page, 'Swan River Academy');
  await expect(page).toHaveURL(/\/t\/2\/certificates$/);
  await expect(page.getByText('Australia/Perth')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Australia/Perth')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // bob: only LCL; alice's tenant 1 is a 404 page.
  await signInAs(page, 'Bob Fraser');
  await expect(page).toHaveURL(/\/t\/3\/certificates$/);
  expect(await tenantSwitcherOptions(page)).toEqual(['Large Corp Learning']);

  await page.goto('/t/1/certificates');
  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.getByText('Harbour Health Training')).toHaveCount(0);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // carol: only HHT, the tenant she shares with alice.
  await signInAs(page, 'Carol Smith');
  await expect(page).toHaveURL(/\/t\/1\/certificates$/);
  await expect(page.getByText('Carol Smith')).toBeVisible();
  expect(await tenantSwitcherOptions(page)).toEqual(['Harbour Health Training']);

  await page.goto('/t/2/certificates');
  await expect(page.getByText('Page not found')).toBeVisible();
});
