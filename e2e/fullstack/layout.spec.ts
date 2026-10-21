import { expect, test } from '@playwright/test';
import { signInAs } from '../fixtures/session';

const backend = `http://127.0.0.1:${process.env.PORT || 3001}`;

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${backend}/api/__test__/reset`)).status()).toBe(204);
});

test('narrow window: the sidebar collapses to an icon rail without covering the content', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/sign-in');
  await signInAs(page, 'Alice Nguyen');
  await expect(page.getByText('45 certificates')).toBeVisible();

  // No floating zero-width trigger over the page content.
  await expect(page.locator('.ant-layout-sider-zero-width-trigger')).toHaveCount(0);
  const sider = page.locator('.ant-layout-sider');
  await expect(sider).toHaveCSS('width', '64px');
  // The search box sits entirely to the right of the rail.
  const siderBox = await sider.boundingBox();
  const searchBox = await page.getByRole('searchbox', { name: 'Search certificates' }).boundingBox();
  expect(searchBox!.x).toBeGreaterThanOrEqual(siderBox!.x + siderBox!.width);
  // Each section stays reachable from its icon.
  await page.getByRole('menuitem', { name: /Bulk issue/ }).click();
  await expect(page).toHaveURL(/\/t\/1\/bulk-issue$/);
});

test('wide window: the sidebar shows icons and labels', async ({ page }) => {
  await page.goto('/sign-in');
  await signInAs(page, 'Alice Nguyen');
  await expect(page.locator('.ant-layout-sider')).toHaveCSS('width', '200px');
  await expect(page.getByRole('menuitem', { name: /Certificates/ }).locator('.anticon')).toHaveCount(1);
});
