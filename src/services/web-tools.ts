/**
 * Web tools service — intercepts Anthropic server-side tools (WebSearch, WebFetch)
 * and implements them using Gemini's native capabilities:
 *
 * - `web_search` → Gemini Google Search grounding (`google_search: {}`)
 * - `web_fetch` (generic URL) → Gemini URL Context (`url_context: {}`)
 * - `web_fetch` (YouTube URL) → Gemini Video Understanding (`fileData`)
 *
 * This service acts as a "sub-agent": it makes a separate Gemini API call
 * with the appropriate tool/content, then formats the result into the
 * Anthropic server-tool response format that Claude Code expects.
 */

import { GeminiClient } from "./gemini-client";
import type {
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
} from "../models/gemini";
import { Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// YouTube URL detection
// ---------------------------------------------------------------------------

const YOUTUBE_REGEX =
  /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)/i;

/**
 * Checks whether a URL points to a YouTube video.
 */
function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_REGEX.test(url);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateServerToolUseId(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "srvtoolu_";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Types — Anthropic server-tool blocks
// ---------------------------------------------------------------------------

/** Represents an Anthropic server-side tool definition in the request. */
export interface AnthropicServerTool {
  type: string; // e.g. "web_search_20250305", "web_fetch_20250910"
  name: string; // "web_search" or "web_fetch"
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
  [key: string]: unknown;
}

/** A WebSearch result entry in the Anthropic format. */
interface WebSearchResult {
  type: "web_search_result";
  url: string;
  title: string;
  encrypted_content: string;
  page_age?: string;
}

/** A web_search_tool_result content block. */
interface WebSearchToolResult {
  type: "web_search_tool_result";
  tool_use_id: string;
  content: WebSearchResult[];
}

/** A server_tool_use content block. */
interface ServerToolUse {
  type: "server_tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A web_fetch_tool_result content block. */
interface WebFetchToolResult {
  type: "web_fetch_tool_result";
  tool_use_id: string;
  content: {
    type: "web_fetch_result";
    url: string;
    content: {
      type: "document";
      source: {
        type: "text";
        media_type: "text/plain";
        data: string;
      };
      title: string;
      citations: { enabled: boolean };
    };
    retrieved_at: string;
  };
}

// ---------------------------------------------------------------------------
// WebToolsService
// ---------------------------------------------------------------------------

/**
 * Handles Anthropic server-side web tools by delegating to Gemini's
 * native web capabilities.
 *
 * **Flow:**
 * 1. Router detects `web_search` / `web_fetch` in the tools array.
 * 2. These tools are extracted and passed to this service.
 * 3. For each request that triggers a web tool, this service makes a
 *    **separate** Gemini API call with the right config.
 * 4. The result is formatted as Anthropic `server_tool_use` +
 *    `web_search_tool_result` / `web_fetch_tool_result` content blocks.
 */
export class WebToolsService {
  private readonly geminiClient: GeminiClient;
  private readonly geminiModel: string;
  private readonly logger: Logger;

  constructor(geminiClient: GeminiClient, geminiModel: string) {
    this.geminiClient = geminiClient;
    this.geminiModel = geminiModel;
    this.logger = Logger.getInstance();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Extracts Anthropic server-side tools from the tools array.
   * Returns the server tools AND the remaining "regular" tools.
   */
  static extractServerTools(tools: unknown[]): {
    serverTools: AnthropicServerTool[];
    regularTools: unknown[];
  } {
    const serverTools: AnthropicServerTool[] = [];
    const regularTools: unknown[] = [];

    for (const tool of tools) {
      const t = tool as Record<string, unknown>;
      if (
        typeof t.type === "string" &&
        (t.type.startsWith("web_search") || t.type.startsWith("web_fetch"))
      ) {
        serverTools.push(t as unknown as AnthropicServerTool);
      } else {
        regularTools.push(tool);
      }
    }

    return { serverTools, regularTools };
  }

  /**
   * Checks whether the given server tools include web_search.
   */
  static hasWebSearch(tools: AnthropicServerTool[]): boolean {
    return tools.some((t) => t.name === "web_search");
  }

  /**
   * Checks whether the given server tools include web_fetch.
   */
  static hasWebFetch(tools: AnthropicServerTool[]): boolean {
    return tools.some((t) => t.name === "web_fetch");
  }

  // -------------------------------------------------------------------------
  // WebSearch via Gemini Google Search
  // -------------------------------------------------------------------------

  /**
   * Performs a web search using Gemini's Google Search grounding.
   *
   * @param query - The search query string.
   * @returns Content blocks in Anthropic format (server_tool_use + web_search_tool_result).
   */
  async performWebSearch(
    query: string
  ): Promise<Array<ServerToolUse | WebSearchToolResult>> {
    const toolUseId = generateServerToolUseId();

    this.logger.info("WebSearch via Gemini Google Search", { query });

    try {
      const request: GeminiGenerateContentRequest = {
        contents: [
          {
            role: "user",
            parts: [{ text: query }],
          },
        ],
        tools: [{ google_search: {} } as any],
        generationConfig: {
          maxOutputTokens: 8192,
        },
      };

      const response = await this.geminiClient.generateContent(
        this.geminiModel,
        request
      );

      // Extract grounding metadata
      const candidate = response.candidates?.[0];
      const groundingMetadata = (candidate as any)?.groundingMetadata;
      const textContent =
        candidate?.content?.parts
          ?.filter((p) => "text" in p)
          .map((p) => (p as { text: string }).text)
          .join("") ?? "";

      // Build search results from grounding chunks
      const searchResults: WebSearchResult[] = [];
      if (groundingMetadata?.groundingChunks) {
        for (const chunk of groundingMetadata.groundingChunks) {
          if (chunk.web) {
            searchResults.push({
              type: "web_search_result",
              url: chunk.web.uri ?? "",
              title: chunk.web.title ?? "",
              // Encode the actual text content as "encrypted_content"
              // Claude Code uses this to build citations
              encrypted_content: Buffer.from(textContent).toString("base64"),
            });
          }
        }
      }

      // If no structured results but we have text, create a synthetic result
      if (searchResults.length === 0 && textContent) {
        searchResults.push({
          type: "web_search_result",
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          title: `Search results for: ${query}`,
          encrypted_content: Buffer.from(textContent).toString("base64"),
        });
      }

      const serverToolUse: ServerToolUse = {
        type: "server_tool_use",
        id: toolUseId,
        name: "web_search",
        input: { query },
      };

      const toolResult: WebSearchToolResult = {
        type: "web_search_tool_result",
        tool_use_id: toolUseId,
        content: searchResults,
      };

      this.logger.debug("WebSearch results", {
        resultCount: searchResults.length,
      });

      return [serverToolUse, toolResult];
    } catch (error) {
      this.logger.error("WebSearch failed", error);
      return this.buildSearchError(toolUseId, query);
    }
  }

  // -------------------------------------------------------------------------
  // WebFetch via Gemini URL Context or YouTube Video Understanding
  // -------------------------------------------------------------------------

  /**
   * Fetches content from a URL using Gemini's URL Context or Video
   * Understanding (for YouTube URLs).
   *
   * @param url    - The URL to fetch content from.
   * @param prompt - Optional context about what to extract.
   * @returns Content blocks in Anthropic format (server_tool_use + web_fetch_tool_result).
   */
  async performWebFetch(
    url: string,
    prompt?: string
  ): Promise<Array<ServerToolUse | WebFetchToolResult>> {
    const toolUseId = generateServerToolUseId();

    if (isYouTubeUrl(url)) {
      return this.fetchYouTubeVideo(url, prompt, toolUseId);
    }

    return this.fetchUrlContent(url, prompt, toolUseId);
  }

  /**
   * Fetches a regular URL using Gemini's URL Context tool.
   */
  private async fetchUrlContent(
    url: string,
    prompt: string | undefined,
    toolUseId: string
  ): Promise<Array<ServerToolUse | WebFetchToolResult>> {
    this.logger.info("WebFetch via Gemini URL Context", { url });

    try {
      const userText = prompt
        ? `${prompt}\n\nURL: ${url}`
        : `Fetch and summarize the content at this URL: ${url}`;

      const request: GeminiGenerateContentRequest = {
        contents: [
          {
            role: "user",
            parts: [{ text: userText }],
          },
        ],
        tools: [{ url_context: {} } as any],
        generationConfig: {
          maxOutputTokens: 16384,
        },
      };

      const response = await this.geminiClient.generateContent(
        this.geminiModel,
        request
      );

      const textContent = this.extractTextFromResponse(response);
      const title = this.extractTitleFromUrl(url);

      return this.buildFetchResult(toolUseId, url, title, textContent);
    } catch (error) {
      this.logger.error("WebFetch URL Context failed", error);
      return this.buildFetchError(toolUseId, url);
    }
  }

  /**
   * Fetches a YouTube video using Gemini's Video Understanding via fileData.
   */
  private async fetchYouTubeVideo(
    url: string,
    prompt: string | undefined,
    toolUseId: string
  ): Promise<Array<ServerToolUse | WebFetchToolResult>> {
    this.logger.info("WebFetch via Gemini YouTube Video Understanding", { url });

    try {
      const userText = prompt
        ? prompt
        : "Please provide a detailed summary of this video, including key topics discussed, main points, and any important details.";

      const request: GeminiGenerateContentRequest = {
        contents: [
          {
            role: "user",
            parts: [
              {
                fileData: {
                  fileUri: url,
                },
              } as any,
              { text: userText },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 16384,
        },
      };

      const response = await this.geminiClient.generateContent(
        this.geminiModel,
        request
      );

      const textContent = this.extractTextFromResponse(response);
      const title = `YouTube Video: ${url}`;

      return this.buildFetchResult(toolUseId, url, title, textContent);
    } catch (error) {
      this.logger.error("WebFetch YouTube failed", error);
      return this.buildFetchError(toolUseId, url);
    }
  }

  // -------------------------------------------------------------------------
  // Response builders
  // -------------------------------------------------------------------------

  /**
   * Builds a successful web_fetch_tool_result.
   */
  private buildFetchResult(
    toolUseId: string,
    url: string,
    title: string,
    content: string
  ): Array<ServerToolUse | WebFetchToolResult> {
    const serverToolUse: ServerToolUse = {
      type: "server_tool_use",
      id: toolUseId,
      name: "web_fetch",
      input: { url },
    };

    const toolResult: WebFetchToolResult = {
      type: "web_fetch_tool_result",
      tool_use_id: toolUseId,
      content: {
        type: "web_fetch_result",
        url,
        content: {
          type: "document",
          source: {
            type: "text",
            media_type: "text/plain",
            data: content,
          },
          title,
          citations: { enabled: false },
        },
        retrieved_at: new Date().toISOString(),
      },
    };

    return [serverToolUse, toolResult];
  }

  /**
   * Builds an error response for web_search.
   */
  private buildSearchError(
    toolUseId: string,
    query: string
  ): Array<ServerToolUse | WebSearchToolResult> {
    return [
      {
        type: "server_tool_use",
        id: toolUseId,
        name: "web_search",
        input: { query },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: toolUseId,
        content: [],
      },
    ];
  }

  /**
   * Builds an error response for web_fetch.
   */
  private buildFetchError(
    toolUseId: string,
    url: string
  ): Array<ServerToolUse | WebFetchToolResult> {
    return [
      {
        type: "server_tool_use",
        id: toolUseId,
        name: "web_fetch",
        input: { url },
      },
      {
        type: "web_fetch_tool_result",
        tool_use_id: toolUseId,
        content: {
          type: "web_fetch_result",
          url,
          content: {
            type: "document",
            source: {
              type: "text",
              media_type: "text/plain",
              data: "Error: Failed to fetch content from URL.",
            },
            title: "Error",
            citations: { enabled: false },
          },
          retrieved_at: new Date().toISOString(),
        },
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Extracts concatenated text from a Gemini response.
   */
  private extractTextFromResponse(
    response: GeminiGenerateContentResponse
  ): string {
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((p) => "text" in p)
      .map((p) => (p as { text: string }).text)
      .join("");
  }

  /**
   * Extracts a human-readable title from a URL.
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname + parsed.pathname;
    } catch {
      return url;
    }
  }
}
