import { expect, test } from '@playwright/test';

test('home page (ok state) matches the baseline', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));

  await page.goto('/');
  await expect(page.getByText('API is healthy')).toBeVisible();

  await expect(page).toHaveScreenshot('home-ok.png', { animations: 'disabled' });
});
