import type { MeResponse } from '@cac/shared';
import { http, HttpResponse } from 'msw';
import { alice, aliceMe, bob, bobMe } from './fixtures';
import { server } from './msw';

const unauthorized = () =>
  HttpResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
    { status: 401 },
  );

/** In-memory stand-in for the session endpoints; `signedInAs` mimics the session cookie. */
export function mockSessionBackend(initial: 'alice' | 'bob' | null = null) {
  const state = { signedInAs: initial };
  const meFor: Record<string, MeResponse> = { alice: aliceMe, bob: bobMe };

  server.use(
    http.get('/api/admins', () => HttpResponse.json({ items: [alice, bob] })),
    http.post('/api/session', async ({ request }) => {
      const { adminId } = (await request.json()) as { adminId: 'alice' | 'bob' };
      state.signedInAs = adminId;
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/session', () => {
      state.signedInAs = null;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('/api/me', () =>
      state.signedInAs ? HttpResponse.json(meFor[state.signedInAs]) : unauthorized(),
    ),
  );
  return state;
}

export { unauthorized };
