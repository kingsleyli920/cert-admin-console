import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ErrorCode, ErrorResponse } from '@cac/shared';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Certificate is already revoked') {
    super(409, 'ALREADY_REVOKED', message);
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor(message = 'Idempotency-Key was already used for a different course') {
    super(422, 'IDEMPOTENCY_KEY_REUSED', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

function body(code: ErrorCode, message: string): ErrorResponse {
  return { error: { code, message } };
}

function describeZodError(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/** Every error response is `{ error: { code, message } }`. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(body('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(body(error.code, error.message));
    }
    if (error instanceof ZodError) {
      return reply.status(400).send(body('VALIDATION_ERROR', describeZodError(error)));
    }
    const fastifyError = error as FastifyError;
    if (fastifyError.validation) {
      return reply.status(400).send(body('VALIDATION_ERROR', fastifyError.message));
    }
    const status = fastifyError.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      // Client errors raised by Fastify itself (malformed JSON, payload too large, ...).
      return reply.status(status).send(body('BAD_REQUEST', fastifyError.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL_ERROR', 'Internal server error'));
  });
}
