import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App, routes } from '../App';
import { server } from '../test/msw';

function renderHome() {
  render(<App router={createMemoryRouter(routes, { initialEntries: ['/'] })} />);
}

describe('home page', () => {
  it('shows a loading state, then the ok state when the API is healthy', async () => {
    server.use(http.get('/api/health', () => HttpResponse.json({ status: 'ok' })));

    renderHome();

    expect(screen.getByRole('status')).toHaveTextContent('Checking API status');
    expect(await screen.findByText('API is healthy')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the error state with the server message when the API returns 500', async () => {
    server.use(
      http.get('/api/health', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
          { status: 500 },
        ),
      ),
    );

    renderHome();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot reach the API');
    expect(alert).toHaveTextContent('Internal server error');
    expect(screen.queryByText('API is healthy')).not.toBeInTheDocument();
  });
});
