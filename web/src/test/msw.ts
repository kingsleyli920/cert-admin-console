import { setupServer } from 'msw/node';

/** Shared MSW server; tests add handlers with `server.use(...)`. */
export const server = setupServer();
