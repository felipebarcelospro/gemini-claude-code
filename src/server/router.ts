/**
 * Request router for the proxy server.
 *
 * Maps incoming Anthropic API endpoints to the appropriate handler
 * functions. Currently supports:
 * - `POST /v1/messages` – Create a Message (main endpoint)
 * - `GET /v1/models`    – List available models (for discovery)
 * - `GET /health`       – Health check
 *
 * Also handles Anthropic server-side tools (`web_search`, `web_fetch`)
 * by delegating to Gemini's native web capabilities.
 */

import type { Server } from "bun";
import type { AnthropicMessagesRequest } from "../models/anthropic";
import { ModelConfigService } from "../models/config";
import { GeminiClient } from "../services/gemini-client";
import { ThoughtSignatureService } from "../services/thought-signature";
import {
  WebToolsService,
  type AnthropicServerTool,
} from "../services/web-tools";
import { RequestConverter } from "../converters/request-converter";
import { ResponseConverter } from "../converters/response-converter";
import { StreamConverter } from "../converters/stream-converter";
import {
  ProxyError,
  InvalidRequestError,
  AuthenticationError,
} from "../utils/errors";
import { Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * HTTP request router that orchestrates the full Anthropic → Gemini
 * proxy pipeline.
 *
 * For each `/v1/messages` request:
 * 1. Validates the request structure.
 * 2. Extracts server-side tools (web_search, web_fetch) if present.
 * 3. Resolves the model name to a Gemini model.
 * 4. Converts Anthropic request → Gemini request.
 * 5. Adds Gemini-native web tools if server-side tools were detected.
 * 6. Calls the Gemini API.
 * 7. Converts Gemini response → Anthropic response (or streams SSE).
 */
export class Router {
  private readonly geminiClient: GeminiClient;
  private readonly modelConfig: ModelConfigService;
  private readonly logger: Logger;

  constructor(geminiClient: GeminiClient, modelConfig: ModelConfigService) {
    this.geminiClient = geminiClient;
    this.modelConfig = modelConfig;
    this.logger = Logger.getInstance();
  }

  /**
   * Handles an incoming HTTP request and returns the response.
   */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    this.logger.debug(`${method} ${path}`);

    try {
      // CORS preflight
      if (method === "OPTIONS") {
        return this.corsResponse();
      }

      // Route dispatch
      if (path === "/v1/messages" && method === "POST") {
        return await this.handleMessages(request);
      }

      if (path === "/v1/models" && method === "GET") {
        return this.handleListModels();
      }

      if (path === "/health" && method === "GET") {
        return this.jsonResponse({ status: "ok" });
      }

      // 404 for unknown routes
      return this.errorResponse(
        new InvalidRequestError(`Unknown endpoint: ${method} ${path}`)
      );
    } catch (error) {
      if (error instanceof ProxyError) {
        return this.errorResponse(error);
      }

      this.logger.error("Unhandled error", error);
      return this.errorResponse(
        new ProxyError(
          error instanceof Error ? error.message : "Internal server error",
          500,
          "api_error"
        )
      );
    }
  }

  // -------------------------------------------------------------------------
  // POST /v1/messages
  // -------------------------------------------------------------------------

  /**
   * Handles the main `/v1/messages` endpoint.
   */
  private async handleMessages(request: Request): Promise<Response> {
    // Parse request body
    const body = (await request.json()) as AnthropicMessagesRequest;

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      throw new InvalidRequestError(
        "'messages' is required and must be an array."
      );
    }
    if (!body.max_tokens || typeof body.max_tokens !== "number") {
      throw new InvalidRequestError(
        "'max_tokens' is required and must be a number."
      );
    }

    // ── Extract server-side tools (web_search, web_fetch) ──────────────
    let serverTools: AnthropicServerTool[] = [];
    if (body.tools && Array.isArray(body.tools)) {
      const extracted = WebToolsService.extractServerTools(body.tools);
      serverTools = extracted.serverTools;

      if (serverTools.length > 0) {
        // Replace tools array with only the regular tools
        body.tools = extracted.regularTools as any;
        this.logger.info("Extracted server-side tools", {
          serverTools: serverTools.map((t) => t.name),
          remainingTools: (body.tools as any[]).length,
        });

        // Log full server-side tool definitions
        for (const st of serverTools) {
          this.logger.debug(`[TOOL-IN] Server tool: ${st.name}`, {
            type: st.type,
            max_uses: st.max_uses,
            allowed_domains: st.allowed_domains,
            blocked_domains: st.blocked_domains,
          });
        }
      }

      // Log regular tool names
      if ((body.tools as any[]).length > 0) {
        const toolNames = (body.tools as any[]).map(
          (t: any) => t.name ?? t.type ?? "unknown"
        );
        this.logger.debug(`[TOOL-IN] Function declarations (${toolNames.length})`, {
          tools: toolNames,
        });
      }
    }

    // Resolve model
    const requestedModel = body.model || "gemini-3.0-flash";
    const capabilities = this.modelConfig.resolve(requestedModel);

    this.logger.info(
      `Request: ${requestedModel} → ${capabilities.geminiModel}`,
      {
        stream: body.stream ?? false,
        messageCount: body.messages.length,
        maxTokens: body.max_tokens,
        hasTools: !!body.tools?.length,
        hasServerTools: serverTools.length > 0,
        thinking: body.thinking?.type ?? "default",
      }
    );

    // Create per-request services
    const thoughtSignatures = new ThoughtSignatureService();
    const requestConverter = new RequestConverter(thoughtSignatures);

    // Build tool name map for resolving tool_use_id → name
    requestConverter.buildToolNameMap(body.messages);

    // Convert Anthropic → Gemini request
    const geminiRequest = requestConverter.convert(body, capabilities);

    // ── Inject Gemini-native web tools if server-side tools detected ───
    if (serverTools.length > 0) {
      this.injectGeminiWebTools(geminiRequest, serverTools);
    }

    if (body.stream) {
      return await this.handleStreamingRequest(
        geminiRequest,
        capabilities,
        thoughtSignatures,
        requestedModel
      );
    } else {
      return await this.handleSyncRequest(
        geminiRequest,
        capabilities,
        thoughtSignatures,
        requestedModel
      );
    }
  }

  /**
   * Injects Gemini-native web tools (google_search, url_context) into
   * the Gemini request when Anthropic server-side tools are detected.
   *
   * This allows Gemini to use Google Search grounding and URL context
   * natively, producing responses that incorporate web data.
   */
  private injectGeminiWebTools(
    geminiRequest: any,
    serverTools: AnthropicServerTool[]
  ): void {
    if (!geminiRequest.tools) {
      geminiRequest.tools = [];
    }

    const hasSearch = WebToolsService.hasWebSearch(serverTools);
    const hasFetch = WebToolsService.hasWebFetch(serverTools);

    if (hasSearch) {
      geminiRequest.tools.push({ google_search: {} });
      this.logger.info("[TOOL-OUT] Injected Gemini google_search tool");
    }

    if (hasFetch) {
      geminiRequest.tools.push({ url_context: {} });
      this.logger.info("[TOOL-OUT] Injected Gemini url_context tool");
    }

    // Log the full tools array being sent to Gemini
    this.logger.debug("[TOOL-OUT] Gemini tools payload", {
      toolCount: geminiRequest.tools.length,
      tools: geminiRequest.tools.map((t: any) => {
        if (t.google_search) return "google_search";
        if (t.url_context) return "url_context";
        if (t.functionDeclarations) {
          return `functionDeclarations(${t.functionDeclarations.map((fd: any) => fd.name).join(", ")})`;
        }
        return JSON.stringify(Object.keys(t));
      }),
    });
  }

  /**
   * Handles a synchronous (non-streaming) messages request.
   */
  private async handleSyncRequest(
    geminiRequest: any,
    capabilities: any,
    thoughtSignatures: ThoughtSignatureService,
    modelName: string
  ): Promise<Response> {
    const geminiResponse = await this.geminiClient.generateContent(
      capabilities.geminiModel,
      geminiRequest
    );

    const responseConverter = new ResponseConverter(
      thoughtSignatures,
      modelName
    );
    const anthropicResponse = responseConverter.convert(geminiResponse);

    this.logger.info("Response", {
      stopReason: anthropicResponse.stop_reason,
      contentBlocks: anthropicResponse.content.length,
      usage: anthropicResponse.usage,
    });

    return this.jsonResponse(anthropicResponse);
  }

  /**
   * Handles a streaming messages request.
   */
  private async handleStreamingRequest(
    geminiRequest: any,
    capabilities: any,
    thoughtSignatures: ThoughtSignatureService,
    modelName: string
  ): Promise<Response> {
    const geminiResponse = await this.geminiClient.streamGenerateContent(
      capabilities.geminiModel,
      geminiRequest
    );

    const streamConverter = new StreamConverter(modelName, thoughtSignatures);
    const sseStream = streamConverter.convertStream(geminiResponse);

    return new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // -------------------------------------------------------------------------
  // GET /v1/models
  // -------------------------------------------------------------------------

  /**
   * Lists available models in an Anthropic-compatible format.
   */
  private handleListModels(): Response {
    const models = this.modelConfig.listModels().map((id) => ({
      id,
      object: "model",
      created: Date.now(),
      owned_by: "google",
    }));

    return this.jsonResponse({ object: "list", data: models });
  }

  // -------------------------------------------------------------------------
  // Response helpers
  // -------------------------------------------------------------------------

  /**
   * Creates a JSON response with CORS headers.
   */
  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }

  /**
   * Converts a ProxyError into an Anthropic-formatted error response.
   */
  private errorResponse(error: ProxyError): Response {
    return this.jsonResponse(error.toResponse(), error.statusCode);
  }

  /**
   * Returns a CORS preflight response.
   */
  private corsResponse(): Response {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
}
