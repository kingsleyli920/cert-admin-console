import {
  adminsResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  meResponseSchema,
  type HealthResponse,
  type MeResponse,
  signInRequestSchema,
} from '@cac/shared';
import type { z, ZodType } from 'zod';

type AdminsResponse = z.infer<typeof adminsResponseSchema>;

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

/** Later sources win per header name; nothing is dropped. */
function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const source of sources) {
    new Headers(source).forEach((value, name) => merged.set(name, value));
  }
  return merged;
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const baseUrl = opts.baseUrl ?? '';
  // Resolve lazily so a fetch replaced after construction (tests) is honoured.
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));

  /** Sends the request and maps transport and non-2xx failures to ApiError. */
  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers: mergeHeaders({ accept: 'application/json' }, opts.headers, init.headers),
      });
    } catch (err) {
      throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'Network error');
    }

    if (!res.ok) {
      const body: unknown = await res.json().catch(() => undefined);
      const parsed = errorResponseSchema.safeParse(body);
      if (parsed.success) {
        throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
      }
      throw new ApiError(res.status, 'UNKNOWN_ERROR', `Request failed with status ${res.status}`);
    }
    return res;
  }

  async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    const res = await send(path, init);
    const body: unknown = await res.json().catch(() => undefined);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(res.status, 'INVALID_RESPONSE', 'Unexpected response from the server');
    }
    return parsed.data;
  }

  return {
    getHealth: (): Promise<HealthResponse> => request('/api/health', healthResponseSchema),
    getAdmins: (): Promise<AdminsResponse> => request('/api/admins', adminsResponseSchema),
    getMe: (): Promise<MeResponse> => request('/api/me', meResponseSchema),
    /** 204 or 200 with an empty body; the session cookie is set by the server. */
    signIn: async (adminId: string): Promise<void> => {
      const body = signInRequestSchema.parse({ adminId });
      await send('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    signOut: async (): Promise<void> => {
      await send('/api/session', { method: 'DELETE' });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
