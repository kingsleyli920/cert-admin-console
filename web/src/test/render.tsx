import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { createMemoryRouter } from 'react-router';
import { App, routes } from '../App';

export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App router={router} />);
  return router;
}

export const serverError = (message: string) =>
  HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });

export async function signInAs(name: string) {
  await userEvent.click(await screen.findByRole('radio', { name }));
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}
