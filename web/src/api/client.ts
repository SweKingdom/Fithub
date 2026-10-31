export interface FieldError {
  field: string;
  message: string;
}

/** A non-2xx answer, parsed from the API's flat error body `{ code, message, fieldErrors? }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestInit {
  method?: string;
  body?: unknown;
}

const LOGIN_PATH = '/api/auth/login';
const NETWORK_MESSAGE = "We couldn't reach the server. Please check your connection and try again.";
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

let unauthenticatedListener: (() => void) | null = null;

/** The auth provider registers here to be told when the session is gone (401 on any call except sign-in). */
export function setUnauthenticatedListener(listener: (() => void) | null): void {
  unauthenticatedListener = listener;
}

function isErrorBody(value: unknown): value is { code?: unknown; message?: unknown; fieldErrors?: unknown } {
  return typeof value === 'object' && value !== null;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (for example a proxy error page): fall back to the generic message.
  }
  if (!isErrorBody(body)) return new ApiError(response.status, 'UNKNOWN', FALLBACK_MESSAGE);
  return new ApiError(
    response.status,
    typeof body.code === 'string' ? body.code : 'UNKNOWN',
    typeof body.message === 'string' ? body.message : FALLBACK_MESSAGE,
    Array.isArray(body.fieldErrors) ? (body.fieldErrors as FieldError[]) : [],
  );
}

/** JSON call to the API with the session cookie. Throws `ApiError` for every non-2xx answer. */
export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }

  if (!response.ok) {
    const error = await toApiError(response);
    if (response.status === 401 && path !== LOGIN_PATH) unauthenticatedListener?.();
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
