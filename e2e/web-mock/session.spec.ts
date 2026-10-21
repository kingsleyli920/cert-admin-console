import { expect, test, type Page } from '@playwright/test';

const alice = { id: 'alice', name: 'Alice Nguyen' };
const bob = { id: 'bob', name: 'Bob Fraser' };
const tenants = {
  HHT: { id: 1, code: 'HHT', name: 'Harbour Health Training', timezone: 'Australia/Sydney' },
  SRA: { id: 2, code: 'SRA', name: 'Swan River Academy', timezone: 'Australia/Perth' },
  LCL: { id: 3, code: 'LCL', name: 'Large Corp Learning', timezone: 'Australia/Sydney' },
};
const meFor = {
  alice: { admin: alice, tenants: [tenants.HHT, tenants.SRA] },
  bob: { admin: bob, tenants: [tenants.LCL] },
};

/** Mocks the session endpoints; `session.as` plays the role of the httpOnly cookie. */
async function mockSession(page: Page, initial: 'alice' | 'bob' | null = null) {
  const session = { as: initial };
  await page.route('**/api/admins', (route) => route.fulfill({ json: { items: [alice, bob] } }));
  await page.route('**/api/session', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      session.as = (request.postDataJSON() as { adminId: 'alice' | 'bob' }).adminId;
    } else {
      session.as = null;
    }
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/me', (route) =>
    session.as
      ? route.fulfill({ json: meFor[session.as] })
      : route.fulfill({
          status: 401,
          json: { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
        }),
  );
  return session;
}

test('anonymous visit to / redirects to the sign-in page', async ({ page }) => {
  await mockSession(page);

  await page.goto('/');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('radio', { name: 'Alice Nguyen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});

test('signing in as alice shows the layout for her first tenant, and tenants can be switched', async ({
  page,
}) => {
  await mockSession(page);
  await page.goto('/sign-in');

  await page.getByRole('radio', { name: 'Alice Nguyen' }).check();
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/t\/1\/certificates$/);
  await expect(page.getByRole('heading', { name: 'Certificates' })).toBeVisible();
  await expect(page.getByText('Certificate Admin')).toBeVisible();
  await expect(page.getByText('Australia/Sydney')).toBeVisible();
  await expect(page.getByText('Alice Nguyen')).toBeVisible();

  await page.getByRole('link', { name: 'Bulk issue' }).click();
  await expect(page).toHaveURL(/\/t\/1\/bulk-issue$/);

  await page.getByRole('combobox', { name: 'Tenant' }).click();
  await page.getByTitle('Swan River Academy').click();

  await expect(page).toHaveURL(/\/t\/2\/bulk-issue$/);
  await expect(page.getByText('Australia/Perth')).toBeVisible();
});

test("a tenant that is not the admin's shows the 404 page", async ({ page }) => {
  await mockSession(page, 'alice');

  await page.goto('/t/3/certificates');

  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Certificates' })).toHaveCount(0);
  await expect(page.getByText('Large Corp Learning')).toHaveCount(0);

  await page.getByRole('button', { name: /back to/i }).click();
  await expect(page).toHaveURL(/\/t\/1\/certificates$/);
});

test('an expired session (401) redirects a tenant page to sign-in', async ({ page }) => {
  await mockSession(page);

  await page.goto('/t/1/certificates');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('radio', { name: 'Bob Fraser' })).toBeVisible();
});

test('Sign out returns to the sign-in page and protects tenant pages again', async ({ page }) => {
  await mockSession(page, 'alice');
  await page.goto('/t/1/certificates');

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText('Signed out')).toBeVisible();

  await page.goto('/t/1/certificates');
  await expect(page).toHaveURL(/\/sign-in$/);
});
