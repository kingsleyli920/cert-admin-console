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

test('bulk issue: course distribution before issuing', async ({ page }) => {
  await page.goto('/t/1/bulk-issue?courseId=101');
  await expect(page.getByRole('button', { name: 'Issue 8 certificates' })).toBeEnabled();
  await expect(page).toHaveScreenshot('bulk-issue-preview.png', { animations: 'disabled' });
});

test('bulk issue: completed run with per-learner outcomes', async ({ page }) => {
  await page.goto('/t/1/bulk-issue?courseId=101');
  await page.getByRole('button', { name: 'Issue 8 certificates' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue certificates' }).click();
  await expect(page).toHaveURL(/\/t\/1\/bulk-issue\/runs\/\d+$/);
  await expect(page.getByTestId('run-progress')).toContainText('16 / 16');
  // createdAt is the real server time; mask it so the baseline stays deterministic.
  await expect(page).toHaveScreenshot('bulk-issue-run-completed.png', {
    animations: 'disabled',
    fullPage: true,
    mask: [page.locator('time')],
  });
});
