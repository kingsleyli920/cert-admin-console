import { errorResponseSchema, healthResponseSchema, type HealthResponse } from '@cac/shared';
import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const baseUrl = opts.baseUrl ?? '';
  // Resolve lazily so a fetch replaced after construction (tests) is honoured.
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request<T>(path: string, schema: ZodType<T>, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers: { accept: 'application/json', ...opts.headers },
      });
    } catch (err) {
      throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'Network error');
    }

    const body: unknown = await res.json().catch(() => undefined);

    if (!res.ok) {
      const parsed = errorResponseSchema.safeParse(body);
      if (parsed.success) {
        throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
      }
      throw new ApiError(res.status, 'UNKNOWN_ERROR', `Request failed with status ${res.status}`);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(res.status, 'INVALID_RESPONSE', 'Unexpected response from the server');
    }
    return parsed.data;
  }

  return {
    getHealth: (): Promise<HealthResponse> => request('/api/health', healthResponseSchema),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
