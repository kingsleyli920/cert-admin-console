import { expect, type Page } from '@playwright/test';

/** Picks an admin on the sign-in page and signs in. */
export async function signInAs(page: Page, adminName: string): Promise<void> {
  await page.getByRole('radio', { name: adminName }).check();
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * Opens the tenant switcher and returns the tenant names it offers.
 * antd renders the visible items with the tenant name as `title` (the role=option list is
 * a hidden, virtualised copy for screen readers). Closes the dropdown again.
 */
export async function tenantSwitcherOptions(page: Page): Promise<string[]> {
  const switcher = page.getByRole('combobox', { name: 'Tenant' });
  await switcher.click();
  const items = page.locator('.ant-select-item-option');
  await expect(items.first()).toBeVisible();
  const names = await items.evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? ''));
  await page.keyboard.press('Escape');
  await expect(items.first()).toBeHidden();
  return names;
}

/** Switches tenant through the top-bar switcher. */
export async function switchTenant(page: Page, tenantName: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Tenant' }).click();
  await page.getByTitle(tenantName).click();
}
