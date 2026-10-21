import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw';

// Node's fetch needs absolute URLs; the browser resolves them against the page.
const nodeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) =>
  typeof input === 'string' && input.startsWith('/')
    ? nodeFetch(new URL(input, window.location.href), init)
    : nodeFetch(input, init);

// antd reads these browser APIs, which jsdom does not implement.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
