/**
 * HTTP server module.
 *
 * Creates and starts a Bun.serve HTTP server that delegates all
 * incoming requests to the Router.
 */

import { Router } from "./router";
import { GeminiClient } from "../services/gemini-client";
import { ModelConfigService } from "../models/config";
import { Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

/** Options for starting the proxy server. */
export interface ServerOptions {
  /** Port to listen on. */
  port: number;

  /** Host/address to bind to. */
  host: string;

  /** Google AI API key for Gemini. */
  apiKey: string;

  /** Optional custom Gemini API base URL. */
  geminiBaseUrl?: string;

  /** Optional model name overrides (Anthropic name → Gemini name). */
  modelOverrides?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// ProxyServer
// ---------------------------------------------------------------------------

/**
 * The main HTTP server that proxies Anthropic API requests to Google Gemini.
 *
 * Uses Bun.serve for maximum performance. Each request is handled
 * independently with its own thought-signature context.
 */
export class ProxyServer {
  private readonly options: ServerOptions;
  private readonly router: Router;
  private readonly logger: Logger;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(options: ServerOptions) {
    this.options = options;
    this.logger = Logger.getInstance();

    const geminiClient = new GeminiClient(options.apiKey, options.geminiBaseUrl);
    const modelConfig = new ModelConfigService(options.modelOverrides);

    this.router = new Router(geminiClient, modelConfig);
  }

  /**
   * Starts the HTTP server.
   *
   * @returns The Bun server instance.
   */
  start(): ReturnType<typeof Bun.serve> {
    const router = this.router;
    const logger = this.logger;

    this.server = Bun.serve({
      port: this.options.port,
      hostname: this.options.host,

      async fetch(request: Request): Promise<Response> {
        const startTime = performance.now();

        try {
          const response = await router.handle(request);

          const duration = (performance.now() - startTime).toFixed(1);
          logger.debug(`Completed in ${duration}ms`);

          return response;
        } catch (error) {
          logger.error("Fatal request error", error);
          return new Response(
            JSON.stringify({
              type: "error",
              error: {
                type: "api_error",
                message: "Internal proxy error",
              },
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },

      error(error: Error): Response {
        logger.error("Server error", error);
        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "api_error",
              message: "Internal proxy error",
            },
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
    });

    return this.server;
  }

  /**
   * Stops the HTTP server gracefully.
   */
  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
      this.logger.info("Server stopped");
    }
  }
}
