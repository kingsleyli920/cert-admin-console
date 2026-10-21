import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockSessionBackend } from '../test/backend';
import { server } from '../test/msw';
import { renderAt, serverError, signInAs } from '../test/render';

describe('sign-in', () => {
  it('signing in as alice lands on her first tenant', async () => {
    mockSessionBackend();
    const router = renderAt('/sign-in');

    await signInAs('Alice Nguyen');

    expect(await screen.findByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/1/certificates');
  });

  it('keeps the Sign in button disabled until an admin is chosen', async () => {
    mockSessionBackend();
    renderAt('/sign-in');

    await screen.findByRole('radio', { name: 'Bob Fraser' });

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('shows an error with Retry when the admin list fails to load', async () => {
    mockSessionBackend();
    let fail = true;
    server.use(
      http.get('/api/admins', () =>
        fail
          ? serverError('Admin list unavailable')
          : HttpResponse.json({ items: [{ id: 'alice', name: 'Alice Nguyen' }] }),
      ),
    );
    const router = renderAt('/sign-in');

    expect(await screen.findByRole('alert')).toHaveTextContent('Admin list unavailable');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('radio', { name: 'Alice Nguyen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });
});

describe('root redirect', () => {
  it('sends a signed-in admin from / to their first tenant', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/1/certificates');
  });

  it('sends an anonymous visitor from / to the sign-in page', async () => {
    mockSessionBackend();
    const router = renderAt('/');

    expect(await screen.findByRole('radio', { name: 'Alice Nguyen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('redirects /t/:tid to its certificates page', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/2');

    expect(await screen.findByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/2/certificates');
  });
});

describe('tenant access', () => {


  it('shows the 404 page for a tenant the admin does not have, without leaking it', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/3/certificates');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/3/certificates');
    expect(screen.queryByRole('heading', { name: 'Certificates' })).not.toBeInTheDocument();
    expect(screen.queryByText('Australia/Sydney')).not.toBeInTheDocument();
    expect(screen.queryByText(/Large Corp/)).not.toBeInTheDocument();
  });

  it("shows the 404 page when bob opens alice's tenant", async () => {
    mockSessionBackend('bob');
    renderAt('/t/1/certificates');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('shows the 404 page for unknown paths and links back to the first tenant', async () => {
    mockSessionBackend('alice');
    const router = renderAt('/t/1/nope');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /back to/i }));

    expect(await screen.findByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/1/certificates');
  });
});

describe('session expiry', () => {
  it('redirects to /sign-in when /api/me answers 401', async () => {
    mockSessionBackend();
    const router = renderAt('/t/1/certificates');

    expect(await screen.findByRole('radio', { name: 'Alice Nguyen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });
});
