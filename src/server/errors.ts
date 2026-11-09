export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "PRICE_CHANGED"
  | "INSUFFICIENT_STOCK"
  | "INACTIVE_PRODUCT"
  | "INSUFFICIENT_CASH"
  | "TILL_CLOSED"
  | "LAYOUT"
  | "RETURN_LIMIT";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  PRICE_CHANGED: 409,
  INSUFFICIENT_STOCK: 409,
  INACTIVE_PRODUCT: 409,
  INSUFFICIENT_CASH: 400,
  TILL_CLOSED: 409,
  LAYOUT: 400,
  RETURN_LIMIT: 409,
};

/** An expected, user-facing failure. `message` is written for staff. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
  get status() {
    return STATUS[this.code];
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Postgres unique violation */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && (!constraint || err.constraint === constraint);
}
