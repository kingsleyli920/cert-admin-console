import type { FastifySchemaCompiler, FastifySerializerCompiler } from 'fastify';
import type { ZodType } from 'zod';

/** Lets route `schema` entries be zod schemas (shared with the web client). */
export const zodValidatorCompiler: FastifySchemaCompiler<ZodType> =
  ({ schema }) =>
  (data) => {
    const result = schema.safeParse(data);
    return result.success ? { value: result.data } : { error: result.error };
  };

export const zodSerializerCompiler: FastifySerializerCompiler<ZodType> =
  ({ schema }) =>
  (data) => {
    const result = schema.safeParse(data);
    if (!result.success) {
      // A bad response is a server bug (500), not a client validation error.
      throw new Error('Response does not match its schema', { cause: result.error });
    }
    return JSON.stringify(result.data);
  };
