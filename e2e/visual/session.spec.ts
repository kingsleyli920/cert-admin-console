import { expect, test } from '@playwright/test';
import { signInAs } from '../fixtures/session';

// Visual baselines against the real backend with the deterministic seed (SPEC §3.1).
const backend = `http://127.0.0.1:${process.env.PORT || 3001}`;

test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${backend}/api/__test__/reset`)).status()).toBe(204);
  await page.clock.setFixedTime(new Date('2026-10-20T01:00:00.000Z'));
});

test('sign-in page', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('radio', { name: 'Carol Smith' })).toBeVisible();
  await expect(page).toHaveScreenshot('sign-in.png', { animations: 'disabled' });
});

test('tenant 404 page inside the layout', async ({ page }) => {
  await page.goto('/sign-in');
  await signInAs(page, 'Bob Fraser');
  await expect(page).toHaveURL(/\/t\/3\/certificates$/);
  await page.goto('/t/1/certificates');
  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page).toHaveScreenshot('tenant-not-found.png', { animations: 'disabled' });
});
