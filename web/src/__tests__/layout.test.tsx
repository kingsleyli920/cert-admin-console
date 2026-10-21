import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockSessionBackend, unauthorized } from '../test/backend';
import { aliceMe } from '../test/fixtures';
import { server } from '../test/msw';
import { renderAt, serverError, signInAs } from '../test/render';

async function pickTenant(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Tenant' }));
  // antd also renders a hidden role=option list for screen readers; click the visible item.
  await userEvent.click(await screen.findByTitle(name));
}

describe('app layout', () => {
  it('shows the app name, admin, current tenant and its timezone', async () => {
    mockSessionBackend('alice');
    renderAt('/t/1/certificates');

    expect(await screen.findByText('Australia/Sydney')).toBeInTheDocument();
    expect(screen.getByText('Certificate Admin')).toBeInTheDocument();
    expect(screen.getByText('Alice Nguyen')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Tenant' })).toBeInTheDocument();
  });

  it('switching tenant keeps the section and updates the timezone', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/1/bulk-issue');
    expect(await screen.findByText('Australia/Sydney')).toBeInTheDocument();

    await pickTenant('Swan River Academy');

    expect(await screen.findByText('Australia/Perth')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/2/bulk-issue');
    expect(screen.queryByText('Australia/Sydney')).not.toBeInTheDocument();
  });

  it('side navigation links keep the current tenant', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/2/certificates');
    await screen.findByText('Australia/Perth');

    await userEvent.click(screen.getByRole('link', { name: 'Bulk issue' }));

    expect(await screen.findByRole('heading', { name: 'Bulk issue' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/2/bulk-issue');
  });

  it('shows an error with Retry when /api/me fails with a server error', async () => {
    mockSessionBackend('alice');
    let fail = true;
    server.use(
      http.get('/api/me', () =>
        fail ? serverError('Session store down') : HttpResponse.json(aliceMe),
      ),
    );
    renderAt('/t/1/certificates');

    expect(await screen.findByRole('alert')).toHaveTextContent('Session store down');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Australia/Sydney')).toBeInTheDocument();
  });
});

describe('sign-out', () => {
  it('redirects to /sign-in when a mutation returns 401 mid-session', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/1/certificates');
    await screen.findByText('Australia/Sydney');

    server.use(http.delete('/api/session', () => unauthorized()));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('radio', { name: 'Alice Nguyen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('signing out returns to /sign-in and a different admin gets only their own tenants', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/1/certificates');
    await screen.findByText('Australia/Sydney');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('radio', { name: 'Bob Fraser' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(await screen.findByText('Signed out')).toBeInTheDocument();

    await signInAs('Bob Fraser');

    expect(await screen.findByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/3/certificates');
    await userEvent.click(screen.getByRole('combobox', { name: 'Tenant' }));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByRole('option', { name: 'Swan River Academy' })).toBeNull();
  });
});
