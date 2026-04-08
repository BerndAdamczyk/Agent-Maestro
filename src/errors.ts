import type { SerializedError } from "./types.js";

export class MaestroError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export class RetryableMaestroError extends MaestroError {
  constructor(
    code: string,
    message: string,
    options: {
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(code, message, { ...options, retryable: true });
  }
}

export class ConfigError extends MaestroError {
  constructor(
    code: string,
    message: string,
    options: {
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(code, message, options);
  }
}

export class OrchestrationError extends MaestroError {
  constructor(
    code: string,
    message: string,
    options: {
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(code, message, options);
  }
}

export class SpawnBudgetExhaustedError extends RetryableMaestroError {
  constructor(details: Record<string, unknown> = {}) {
    super("SPAWN_BUDGET_EXHAUSTED", "Spawn budget exhausted, delegation queued", { details });
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof MaestroError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      retryable: error.retryable,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    const withCode = error as Error & { code?: string };
    return {
      name: error.name,
      message: error.message,
      code: withCode.code,
    };
  }

  return {
    name: "Error",
    message: typeof error === "string" ? error : JSON.stringify(error),
  };
}
