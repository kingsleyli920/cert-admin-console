import { createApiClient } from './client';

/** App-wide client; same-origin in the browser (Vite proxies /api in dev). */
export const api = createApiClient();
