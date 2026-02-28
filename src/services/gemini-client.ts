/**
 * Gemini API HTTP client service.
 *
 * Provides a clean interface for making requests to the Google Gemini
 * REST API, handling both synchronous and streaming endpoints.
 *
 * This client operates at the HTTP level using `fetch`, avoiding
 * any Google SDK dependency for maximum performance and minimal
 * bundle size in the Bun runtime.
 */

import type {
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
} from "../models/gemini";
import { mapGeminiError, type ProxyError } from "../utils/errors";
import { Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ---------------------------------------------------------------------------
// GeminiClient
// ---------------------------------------------------------------------------

/**
 * HTTP client for the Google Gemini REST API.
 *
 * Supports:
 * - `generateContent` (synchronous, complete response)
 * - `streamGenerateContent` (streaming, chunked response)
 *
 * @example
 * ```ts
 * const client = new GeminiClient("your-api-key");
 * const response = await client.generateContent("gemini-3-flash-preview", request);
 * ```
 */
export class GeminiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly logger: Logger;

  /**
   * @param apiKey  - Google AI API key.
   * @param baseUrl - Optional custom base URL (for proxies / testing).
   */
  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? GEMINI_API_BASE;
    this.logger = Logger.getInstance();
  }

  /**
   * Sends a synchronous `generateContent` request.
   *
   * @param model   - The Gemini model identifier (e.g. "gemini-3-flash-preview").
   * @param request - The Gemini request body.
   * @returns The parsed Gemini response.
   * @throws {ProxyError} If the request fails.
   */
  async generateContent(
    model: string,
    request: GeminiGenerateContentRequest
  ): Promise<GeminiGenerateContentResponse> {
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

    this.logger.debug("Gemini generateContent request", {
      model,
      contentCount: request.contents.length,
      hasTools: !!request.tools,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error("Gemini API error", {
        status: response.status,
        body: errorBody.substring(0, 500),
      });
      throw mapGeminiError(response.status, errorBody);
    }

    const data = (await response.json()) as GeminiGenerateContentResponse;

    this.logger.debug("Gemini generateContent response", {
      candidateCount: data.candidates?.length ?? 0,
      usage: data.usageMetadata,
    });

    return data;
  }

  /**
   * Sends a streaming `streamGenerateContent` request.
   *
   * Returns the raw `Response` object so the caller can process
   * the stream incrementally.
   *
   * @param model   - The Gemini model identifier.
   * @param request - The Gemini request body.
   * @returns The raw fetch Response (with readable body stream).
   * @throws {ProxyError} If the initial request fails.
   */
  async streamGenerateContent(
    model: string,
    request: GeminiGenerateContentRequest
  ): Promise<Response> {
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    this.logger.debug("Gemini streamGenerateContent request", {
      model,
      contentCount: request.contents.length,
      hasTools: !!request.tools,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error("Gemini streaming API error", {
        status: response.status,
        body: errorBody.substring(0, 500),
      });
      throw mapGeminiError(response.status, errorBody);
    }

    return response;
  }
}
