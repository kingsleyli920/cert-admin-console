import { expect, test } from '@playwright/test';

test('home page shows the ok state when /api/health succeeds', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));

  await page.goto('/');

  await expect(page.getByText('API is healthy')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('home page shows the error state when /api/health returns 500', async ({ page }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 500,
      json: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    }),
  );

  await page.goto('/');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Cannot reach the API');
  await expect(alert).toContainText('Internal server error');
  await expect(page.getByText('API is healthy')).toHaveCount(0);
});
