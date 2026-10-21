import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockSessionBackend } from '../test/backend';
import { renderAt } from '../test/render';

/**
 * Opens the tenant switcher and returns the names of the tenants it offers. antd virtualises
 * the hidden role=option list, so read the visible items (they carry the name as `title`).
 */
async function switcherTenants(): Promise<string[]> {
  await userEvent.click(screen.getByRole('combobox', { name: 'Tenant' }));
  await screen.findByRole('listbox');
  return Array.from(document.querySelectorAll('.ant-select-item-option')).map(
    (el) => el.getAttribute('title') ?? '',
  );
}

async function pickTenant(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Tenant' }));
  // antd also renders a hidden role=option list for screen readers; click the visible item.
  await userEvent.click(await screen.findByTitle(name));
}

describe('tenant switcher per admin', () => {
  it.each([
    ['alice', '/t/1/certificates', 'Australia/Sydney', ['Harbour Health Training', 'Swan River Academy', 'New Horizons Institute']],
    ['bob', '/t/3/certificates', 'Australia/Sydney', ['Large Corp Learning']],
    ['carol', '/t/1/certificates', 'Australia/Sydney', ['Harbour Health Training']],
  ] as const)('%s sees exactly their own tenants', async (admin, path, timezone, expected) => {
    mockSessionBackend(admin);
    renderAt(path);
    await screen.findByText(timezone);

    expect(await switcherTenants()).toEqual(expected);
  });
});

describe('multi-tenant admin (alice)', () => {
  it('shows each tenant timezone and updates the URL while switching HHT -> SRA -> NHI', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/1/certificates');
    expect(await screen.findByText('Australia/Sydney')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/1/certificates');

    await pickTenant('Swan River Academy');
    expect(await screen.findByText('Australia/Perth')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/2/certificates');
    expect(screen.queryByText('Australia/Sydney')).not.toBeInTheDocument();

    await pickTenant('New Horizons Institute');
    expect(await screen.findByText('Australia/Brisbane')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/4/certificates');
    expect(screen.queryByText('Australia/Perth')).not.toBeInTheDocument();
  });
});

describe('single-tenant admin on a foreign tenant', () => {
  it('carol opening /t/2/certificates sees the 404 page, and the sidebar still points at tenant 1', async () => {
    mockSessionBackend('carol');
    const router = renderAt('/t/2/certificates');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/2/certificates');
    expect(screen.queryByRole('heading', { name: 'Certificates' })).not.toBeInTheDocument();
    expect(screen.queryByText('Australia/Perth')).not.toBeInTheDocument();
    expect(screen.queryByText(/Swan River/)).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Certificates' })).toHaveAttribute('href', '/t/1/certificates');
    expect(screen.getByRole('link', { name: 'Bulk issue' })).toHaveAttribute('href', '/t/1/bulk-issue');
  });
});
