import { expect, test, type Page } from '@playwright/test';
import { signInAs, switchTenant, tenantSwitcherOptions } from '../fixtures/session';

const alice = { id: 'alice', name: 'Alice Nguyen' };
const bob = { id: 'bob', name: 'Bob Fraser' };
const carol = { id: 'carol', name: 'Carol Smith' };
const tenants = {
  HHT: { id: 1, code: 'HHT', name: 'Harbour Health Training', timezone: 'Australia/Sydney' },
  SRA: { id: 2, code: 'SRA', name: 'Swan River Academy', timezone: 'Australia/Perth' },
  LCL: { id: 3, code: 'LCL', name: 'Large Corp Learning', timezone: 'Australia/Sydney' },
  NHI: { id: 4, code: 'NHI', name: 'New Horizons Institute', timezone: 'Australia/Brisbane' },
};
type AdminId = 'alice' | 'bob' | 'carol';
const meFor = {
  alice: { admin: alice, tenants: [tenants.HHT, tenants.SRA, tenants.NHI] },
  bob: { admin: bob, tenants: [tenants.LCL] },
  carol: { admin: carol, tenants: [tenants.HHT] },
};

/** Mocks the session endpoints; `session.as` plays the role of the httpOnly cookie. */
async function mockSession(page: Page, initial: AdminId | null = null) {
  const session = { as: initial };
  await page.route('**/api/admins', (route) =>
    route.fulfill({ json: { items: [alice, bob, carol] } }),
  );
  await page.route('**/api/session', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      session.as = (request.postDataJSON() as { adminId: AdminId }).adminId;
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

test.describe('tenant switcher per admin', () => {
  const cases: Array<[AdminId, string, string[]]> = [
    ['alice', 'Alice Nguyen', ['Harbour Health Training', 'Swan River Academy', 'New Horizons Institute']],
    ['bob', 'Bob Fraser', ['Large Corp Learning']],
    ['carol', 'Carol Smith', ['Harbour Health Training']],
  ];
  for (const [id, name, expected] of cases) {
    test(`${id} signs in and the switcher lists only ${expected.length} tenant(s)`, async ({ page }) => {
      await mockSession(page);
      await page.goto('/sign-in');

      await signInAs(page, name);

      await expect(page).toHaveURL(new RegExp(`/t/${meFor[id].tenants[0].id}/certificates$`));
      expect(await tenantSwitcherOptions(page)).toEqual(expected);
    });
  }

  test('alice switching HHT -> SRA -> NHI updates the timezone label and the URL', async ({ page }) => {
    await mockSession(page, 'alice');
    await page.goto('/t/1/certificates');
    await expect(page.getByText('Australia/Sydney')).toBeVisible();

    await switchTenant(page, 'Swan River Academy');
    await expect(page).toHaveURL(/\/t\/2\/certificates$/);
    await expect(page.getByText('Australia/Perth')).toBeVisible();

    await switchTenant(page, 'New Horizons Institute');
    await expect(page).toHaveURL(/\/t\/4\/certificates$/);
    await expect(page.getByText('Australia/Brisbane')).toBeVisible();
  });
});

test.describe('tenants the admin does not manage show the 404 page', () => {
  test("bob opening alice's tenant 1", async ({ page }) => {
    await mockSession(page, 'bob');

    await page.goto('/t/1/certificates');

    await expect(page.getByText('Page not found')).toBeVisible();
    await expect(page.getByText('Harbour Health Training')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Certificates' })).toHaveAttribute(
      'href',
      '/t/3/certificates',
    );
  });

  test('carol opening SRA (tenant 2); the sidebar still points at HHT', async ({ page }) => {
    await mockSession(page, 'carol');

    await page.goto('/t/2/certificates');

    await expect(page.getByText('Page not found')).toBeVisible();
    await expect(page.getByText('Swan River Academy')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Certificates' })).toHaveAttribute(
      'href',
      '/t/1/certificates',
    );
    await expect(page.getByRole('link', { name: 'Bulk issue' })).toHaveAttribute(
      'href',
      '/t/1/bulk-issue',
    );

    await page.getByRole('button', { name: /back to/i }).click();
    await expect(page).toHaveURL(/\/t\/1\/certificates$/);
    await expect(page.getByText('Australia/Sydney')).toBeVisible();
  });
});
