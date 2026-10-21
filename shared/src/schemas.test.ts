import { describe, expect, it } from 'vitest';
import { certificateListQuerySchema, errorResponseSchema, healthResponseSchema } from './index';

describe('healthResponseSchema', () => {
  it('accepts the ok status', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejects any other status', () => {
    expect(healthResponseSchema.safeParse({ status: 'down' }).success).toBe(false);
    expect(healthResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('errorResponseSchema', () => {
  it('accepts the { error: { code, message } } envelope', () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
    expect(errorResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a body without a code or message', () => {
    expect(errorResponseSchema.safeParse({ error: { message: 'x' } }).success).toBe(false);
    expect(errorResponseSchema.safeParse({ error: { code: 'X' } }).success).toBe(false);
    expect(errorResponseSchema.safeParse({ message: 'x' }).success).toBe(false);
  });
});

describe('certificateListQuerySchema', () => {
  it('applies defaults for an empty query string', () => {
    expect(certificateListQuerySchema.parse({})).toEqual({
      sort: 'issuedAt',
      order: 'desc',
      page: 1,
      pageSize: 20,
    });
  });

  it('coerces numeric query-string values', () => {
    const q = certificateListQuerySchema.parse({ courseId: '7', page: '3', pageSize: '50' });
    expect(q).toMatchObject({ courseId: 7, page: 3, pageSize: 50 });
  });

  it.each([
    [{ pageSize: '101' }],
    [{ page: '0' }],
    [{ sort: 'issued_at; DROP TABLE certificates' }],
    [{ status: 'expired' }],
    [{ order: 'up' }],
  ])('rejects %o', (input) => {
    expect(certificateListQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('errorCodeSchema', () => {
  it('rejects codes outside the contract', () => {
    expect(errorResponseSchema.safeParse({ error: { code: 'CONFLICT', message: 'x' } }).success).toBe(
      false,
    );
  });
});
