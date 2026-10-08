import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorCode } from "../shared/domain.ts";

/** A failure that maps to the single API error envelope (SPEC section 8). */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorBody(code: ApiErrorCode, message: string, requestId: string, details?: unknown) {
  return { error: { code, message, requestId, ...(details === undefined ? {} : { details }) } };
}

export function errorResponse(
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): Response {
  return Response.json(errorBody(code, message, requestId, details), {
    status,
    headers: { "cache-control": "no-store" },
  });
}
