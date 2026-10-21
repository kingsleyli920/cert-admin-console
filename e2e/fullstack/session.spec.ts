import { expect, test } from '@playwright/test';

// Needs the real backend (npm run test:e2e:ui); sign-in only writes a cookie, so no DB reset is required.
test('alice signs in, sees HHT with its timezone, switches to SRA, and signs out', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByRole('radio', { name: 'Alice Nguyen' }).check();
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/t\/\d+\/certificates$/);
  await expect(page.getByText('Australia/Sydney')).toBeVisible();
  await expect(page.getByText('Alice Nguyen')).toBeVisible();

  await page.getByRole('combobox', { name: 'Tenant' }).click();
  await page.getByTitle('Swan River Academy').click();
  await expect(page.getByText('Australia/Perth')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Australia/Perth')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("bob opening alice's tenant sees the 404 page, and anonymous users are sent to sign-in", async ({
  page,
}) => {
  await page.goto('/t/1/certificates');
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByRole('radio', { name: 'Bob Fraser' }).check();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Large Corp Learning')).toBeVisible();

  await page.goto('/t/1/certificates');
  await expect(page.getByText('Page not found')).toBeVisible();
});
