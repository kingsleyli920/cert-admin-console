import { describe, expect, it } from 'vitest';
import { errorResponseSchema, healthResponseSchema } from './index';

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
