import { expect, test } from '@playwright/test';
import { signInAs } from '../fixtures/session';

// Visual baselines against the real backend with the deterministic seed (SPEC §3.1).
const backend = `http://127.0.0.1:${process.env.PORT || 3001}`;

test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${backend}/api/__test__/reset`)).status()).toBe(204);
  await page.clock.setFixedTime(new Date('2026-10-20T01:00:00.000Z'));
  await page.goto('/sign-in');
  await signInAs(page, 'Alice Nguyen');
  await expect(page.getByText('45 certificates')).toBeVisible();
});

test('valid certificate on the Sydney DST edge, with revoke dialog', async ({ page }) => {
  await page.goto('/t/1/certificates/45');
  await expect(page.getByText('5 Apr 2026, 1:30 am AEDT').first()).toBeVisible();
  await expect(page).toHaveScreenshot('detail-valid.png', { animations: 'disabled' });
  await page.getByRole('button', { name: 'Revoke certificate' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveScreenshot('detail-revoke-dialog.png', { animations: 'disabled' });
});

test('revoked certificate with its audit trail', async ({ page }) => {
  await page.goto('/t/1/certificates/3');
  await expect(page.getByText('Audit trail')).toBeVisible();
  await expect(page).toHaveScreenshot('detail-revoked.png', { animations: 'disabled', fullPage: true });
});
