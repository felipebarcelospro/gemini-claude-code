/**
 * Error handling utilities for the proxy server.
 *
 * Provides structured error classes that map to Anthropic API error
 * responses, ensuring Claude Code receives properly formatted error
 * messages regardless of the upstream Gemini error.
 */

// ---------------------------------------------------------------------------
// Base proxy error
// ---------------------------------------------------------------------------

/**
 * Base class for all proxy errors.
 * Maps to Anthropic's error response format.
 */
export class ProxyError extends Error {
  /** HTTP status code to return to the client. */
  readonly statusCode: number;

  /** Anthropic error type identifier. */
  readonly errorType: string;

  constructor(message: string, statusCode: number, errorType: string) {
    super(message);
    this.name = "ProxyError";
    this.statusCode = statusCode;
    this.errorType = errorType;
  }

  /**
   * Converts this error to an Anthropic-compatible error response body.
   */
  toResponse(): { type: "error"; error: { type: string; message: string } } {
    return {
      type: "error",
      error: {
        type: this.errorType,
        message: this.message,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Specific error types
// ---------------------------------------------------------------------------

/** The request was invalid or malformed. */
export class InvalidRequestError extends ProxyError {
  constructor(message: string) {
    super(message, 400, "invalid_request_error");
    this.name = "InvalidRequestError";
  }
}

/** Authentication failed (missing or invalid API key). */
export class AuthenticationError extends ProxyError {
  constructor(message = "Invalid API key provided.") {
    super(message, 401, "authentication_error");
    this.name = "AuthenticationError";
  }
}

/** The requested resource was not found. */
export class NotFoundError extends ProxyError {
  constructor(message = "The requested resource was not found.") {
    super(message, 404, "not_found_error");
    this.name = "NotFoundError";
  }
}

/** Rate limit exceeded. */
export class RateLimitError extends ProxyError {
  constructor(message = "Rate limit exceeded. Please retry after a brief wait.") {
    super(message, 429, "rate_limit_error");
    this.name = "RateLimitError";
  }
}

/** Upstream Gemini API error. */
export class UpstreamError extends ProxyError {
  /** The original response status from Gemini. */
  readonly upstreamStatus: number;

  constructor(message: string, upstreamStatus: number) {
    const statusCode = upstreamStatus >= 500 ? 502 : upstreamStatus;
    super(message, statusCode, "api_error");
    this.name = "UpstreamError";
    this.upstreamStatus = upstreamStatus;
  }
}

/** Server overloaded. */
export class OverloadedError extends ProxyError {
  constructor(message = "The server is temporarily overloaded.") {
    super(message, 529, "overloaded_error");
    this.name = "OverloadedError";
  }
}

// ---------------------------------------------------------------------------
// Error mapping utility
// ---------------------------------------------------------------------------

/**
 * Maps a Gemini API HTTP error status to the corresponding ProxyError.
 *
 * @param status  - The HTTP status from the Gemini API response.
 * @param body    - The raw error body from Gemini.
 * @returns A ProxyError suitable for returning to the Anthropic client.
 */
export function mapGeminiError(status: number, body: string): ProxyError {
  let message: string;
  try {
    const parsed = JSON.parse(body);
    message = parsed?.error?.message ?? body;
  } catch {
    message = body;
  }

  switch (status) {
    case 400:
      return new InvalidRequestError(`Gemini API: ${message}`);
    case 401:
    case 403:
      return new AuthenticationError(`Gemini API authentication failed: ${message}`);
    case 404:
      return new NotFoundError(`Gemini model not found: ${message}`);
    case 429:
      return new RateLimitError(`Gemini API rate limit: ${message}`);
    case 503:
      return new OverloadedError(`Gemini API overloaded: ${message}`);
    default:
      return new UpstreamError(`Gemini API error (${status}): ${message}`, status);
  }
}
