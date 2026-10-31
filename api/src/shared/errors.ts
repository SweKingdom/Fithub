import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/** One invalid input field; `field` is a dotted path such as `address.city`. */
export interface FieldError {
  field: string;
  message: string;
}

/** Flat error body returned by every failing `/api` call (ADR-008). */
export interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: FieldError[];
}

/** A failure the caller can understand and act on. Never carries internal detail. */
export class DomainError extends Error {
  /** Same value as `httpStatus`; Fastify and its plugins read `statusCode`. */
  statusCode: number;

  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly fieldErrors?: FieldError[],
  ) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = httpStatus;
  }
}

export function unauthenticated(): DomainError {
  return new DomainError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
}

export function forbidden(message = "You don't have permission to do this."): DomainError {
  return new DomainError('FORBIDDEN', message, 403);
}

const VALIDATION_MESSAGE = 'Some fields are missing or invalid.';

interface ValidationIssue {
  instancePath?: string;
  message?: string;
  params?: { missingProperty?: string };
}

function fieldFromPath(path: string): string {
  return path.replace(/^\//, '').split('/').filter(Boolean).join('.');
}

function validationBody(fieldErrors: FieldError[]): ErrorBody {
  return { code: 'VALIDATION_ERROR', message: VALIDATION_MESSAGE, fieldErrors };
}

function isValidationIssueList(value: unknown): value is ValidationIssue[] {
  return Array.isArray(value);
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

function toResponse(error: unknown): { status: number; body: ErrorBody; unexpected: boolean } {
  if (error instanceof DomainError) {
    const body: ErrorBody = { code: error.code, message: error.message };
    if (error.fieldErrors) body.fieldErrors = error.fieldErrors;
    return { status: error.httpStatus, body, unexpected: false };
  }

  if (error instanceof ZodError) {
    const fieldErrors = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return { status: 400, body: validationBody(fieldErrors), unexpected: false };
  }

  const validation = (error as { validation?: unknown } | null)?.validation;
  if (isValidationIssueList(validation)) {
    const fieldErrors = validation.map((issue) => ({
      field: fieldFromPath(issue.instancePath ?? '') || issue.params?.missingProperty || '',
      message: issue.message ?? 'Invalid value.',
    }));
    return { status: 400, body: validationBody(fieldErrors), unexpected: false };
  }

  const status = statusOf(error);
  if (status === 429) {
    return {
      status: 429,
      body: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many requests. Please wait a moment and try again.' },
      unexpected: false,
    };
  }
  if (status === 400) {
    return { status: 400, body: { code: 'VALIDATION_ERROR', message: VALIDATION_MESSAGE }, unexpected: false };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return {
      status,
      body: { code: 'BAD_REQUEST', message: 'The request could not be processed.' },
      unexpected: false,
    };
  }

  return {
    status: 500,
    body: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    unexpected: true,
  };
}

/** Maps every error to the flat body. The stack of an unexpected error is logged, never returned. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => {
    const body: ErrorBody = { code: 'NOT_FOUND', message: 'This page or resource does not exist.' };
    return reply.code(404).send(body);
  });

  app.setErrorHandler((error, request, reply) => {
    const { status, body, unexpected } = toResponse(error);
    if (unexpected) request.log.error({ err: error }, 'request failed');
    return reply.code(status).send(body);
  });
}
