import { expect, test } from '@playwright/test';

test('home page shows the ok state against the real backend', async ({ page }) => {
  const health = page.waitForResponse((res) => res.url().endsWith('/api/health'));

  await page.goto('/');

  expect((await health).status()).toBe(200);
  await expect(page.getByText('API is healthy')).toBeVisible();
});
