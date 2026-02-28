/**
 * Anthropic → Gemini request converter.
 *
 * Transforms an Anthropic Messages API request into a Gemini
 * `generateContent` request. This is the inbound half of the proxy:
 *
 *   Claude Code  →  Anthropic request  →  [this converter]  →  Gemini request
 *
 * Key conversion responsibilities:
 * - Messages → Contents (role mapping, content block translation)
 * - System prompt → systemInstruction
 * - Tools → functionDeclarations
 * - Tool choice → functionCallingConfig
 * - Thinking config → thinkingConfig
 * - Thought signature injection for Gemini 3 models
 */

import type {
  AnthropicMessagesRequest,
  AnthropicMessage,
  AnthropicContentBlockParam,
  AnthropicToolResultBlockParam,
  AnthropicTextBlockParam,
  AnthropicImageBlockParam,
  AnthropicToolUseBlock,
  AnthropicTool,
  AnthropicToolChoice,
  AnthropicThinkingConfig,
} from "../models/anthropic";
import type {
  GeminiGenerateContentRequest,
  GeminiContent,
  GeminiPart,
  GeminiTool,
  GeminiToolConfig,
  GeminiFunctionCallingMode,
  GeminiGenerationConfig,
  GeminiThinkingConfig,
  GeminiThinkingLevel,
} from "../models/gemini";
import type { ModelCapabilities } from "../models/config";
import {
  ThoughtSignatureService,
  DUMMY_THOUGHT_SIGNATURE,
} from "../services/thought-signature";

// ---------------------------------------------------------------------------
// RequestConverter
// ---------------------------------------------------------------------------

/**
 * Converts Anthropic Messages API requests into Gemini generateContent
 * request format.
 *
 * Stateless—each call to `convert()` is independent. Thought signatures
 * are handled via the injected `ThoughtSignatureService`.
 */
export class RequestConverter {
  private readonly thoughtSignatures: ThoughtSignatureService;

  constructor(thoughtSignatures: ThoughtSignatureService) {
    this.thoughtSignatures = thoughtSignatures;
  }

  /**
   * Performs the full conversion from Anthropic to Gemini request format.
   *
   * @param request      - The incoming Anthropic request body.
   * @param capabilities - Resolved model capabilities.
   * @returns A ready-to-send Gemini request body.
   */
  convert(
    request: AnthropicMessagesRequest,
    capabilities: ModelCapabilities
  ): GeminiGenerateContentRequest {
    const geminiRequest: GeminiGenerateContentRequest = {
      contents: this.convertMessages(request.messages, capabilities),
    };

    // System instruction
    if (request.system) {
      geminiRequest.systemInstruction = this.convertSystemPrompt(request.system);
    }

    // Tools
    if (request.tools && request.tools.length > 0) {
      geminiRequest.tools = this.convertTools(request.tools);
    }

    // Tool choice
    if (request.tool_choice) {
      geminiRequest.toolConfig = this.convertToolChoice(
        request.tool_choice,
        request.tools
      );
    }

    // Generation config
    geminiRequest.generationConfig = this.buildGenerationConfig(
      request,
      capabilities
    );

    // Safety settings - disable all filters for coding use
    geminiRequest.safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ];

    return geminiRequest;
  }

  // -------------------------------------------------------------------------
  // Messages → Contents
  // -------------------------------------------------------------------------

  /**
   * Converts the Anthropic messages array into Gemini contents.
   *
   * Handles:
   * - Simple string content → text part
   * - Content block arrays (text, image, tool_use, tool_result)
   * - Role mapping (user/assistant → user/model)
   * - Tool result messages → functionResponse parts with user role
   * - Thought signature injection for replayed assistant messages
   */
  private convertMessages(
    messages: AnthropicMessage[],
    capabilities: ModelCapabilities
  ): GeminiContent[] {
    const contents: GeminiContent[] = [];

    for (const message of messages) {
      const converted = this.convertSingleMessage(message, capabilities);
      contents.push(...converted);
    }

    // Ensure thought signatures on function call parts
    if (capabilities.isGemini3) {
      this.thoughtSignatures.ensureSignatures(contents, true);
    }

    return contents;
  }

  /**
   * Converts a single Anthropic message, potentially yielding multiple
   * Gemini Content objects (e.g. when a user message contains both text
   * and tool_result blocks, which need separate Gemini Content entries).
   */
  private convertSingleMessage(
    message: AnthropicMessage,
    capabilities: ModelCapabilities
  ): GeminiContent[] {
    const role = message.role === "assistant" ? "model" : "user";

    // Simple string content
    if (typeof message.content === "string") {
      return [{ role, parts: [{ text: message.content }] }];
    }

    // Content blocks
    const textAndImageParts: GeminiPart[] = [];
    const toolUseParts: GeminiPart[] = [];
    const toolResultContents: GeminiContent[] = [];

    for (const block of message.content) {
      switch (block.type) {
        case "text":
          textAndImageParts.push({ text: (block as AnthropicTextBlockParam).text });
          break;

        case "image":
          textAndImageParts.push(
            this.convertImageBlock(block as AnthropicImageBlockParam)
          );
          break;

        case "tool_use": {
          const toolUse = block as AnthropicToolUseBlock;
          const fcPart: GeminiPart = {
            functionCall: {
              name: toolUse.name,
              args: toolUse.input,
            },
          };

          // For replayed assistant messages, inject dummy signature if needed
          if (role === "model" && capabilities.isGemini3) {
            if (toolUseParts.length === 0) {
              // First FC in step needs signature
              (fcPart as { thoughtSignature?: string }).thoughtSignature =
                DUMMY_THOUGHT_SIGNATURE;
            }
          }

          toolUseParts.push(fcPart);
          break;
        }

        case "tool_result": {
          const result = block as AnthropicToolResultBlockParam;
          toolResultContents.push(
            this.convertToolResult(result)
          );
          break;
        }
      }
    }

    const results: GeminiContent[] = [];

    // Assistant (model) turn: combine text + tool_use parts
    if (role === "model") {
      const allParts = [...textAndImageParts, ...toolUseParts];
      if (allParts.length > 0) {
        results.push({ role: "model", parts: allParts });
      }
    } else {
      // User turn: text/images first, then function responses
      if (textAndImageParts.length > 0) {
        results.push({ role: "user", parts: textAndImageParts });
      }
      results.push(...toolResultContents);
    }

    // Fallback: ensure at least one content
    if (results.length === 0) {
      results.push({ role, parts: [{ text: "" }] });
    }

    return results;
  }

  /**
   * Converts a tool_result content block into a Gemini functionResponse content.
   *
   * The Gemini API expects functionResponse parts inside a "user" role content.
   */
  private convertToolResult(block: AnthropicToolResultBlockParam): GeminiContent {
    let responseData: Record<string, unknown>;

    if (block.is_error) {
      responseData = { error: this.extractToolResultText(block) };
    } else {
      responseData = { result: this.extractToolResultText(block) };
    }

    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: this.resolveToolName(block.tool_use_id),
            response: responseData,
          },
        },
      ],
    };
  }

  /**
   * Extracts text content from a tool_result block.
   * tool_result.content can be a string or an array of content blocks.
   */
  private extractToolResultText(block: AnthropicToolResultBlockParam): string {
    if (!block.content) return "";
    if (typeof block.content === "string") return block.content;

    return block.content
      .filter((b) => b.type === "text")
      .map((b) => (b as AnthropicTextBlockParam).text)
      .join("\n");
  }

  /**
   * Temporary tool name resolver.
   * In the Anthropic API, tool results reference tool_use_id, but Gemini
   * needs the function name. Since we need to maintain consistency, we
   * store the mapping during message conversion.
   *
   * As an optimisation, tool_use_id values in Claude Code follow a pattern,
   * and the name is tracked in the same message array.
   */
  private toolNameMap = new Map<string, string>();

  /**
   * Resolves a tool_use_id to its function name.
   * Falls back to the id itself if unresolved.
   */
  private resolveToolName(toolUseId: string): string {
    return this.toolNameMap.get(toolUseId) ?? toolUseId;
  }

  /**
   * Pre-scans messages to build a tool_use_id → name mapping.
   * Should be called before message conversion.
   */
  buildToolNameMap(messages: AnthropicMessage[]): void {
    this.toolNameMap.clear();
    for (const msg of messages) {
      if (typeof msg.content === "string") continue;
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          const tu = block as AnthropicToolUseBlock;
          this.toolNameMap.set(tu.id, tu.name);
        }
      }
    }
  }

  /**
   * Converts an image content block to a Gemini inline data part.
   */
  private convertImageBlock(block: AnthropicImageBlockParam): GeminiPart {
    if (block.source.type === "base64") {
      return {
        inlineData: {
          mimeType: block.source.media_type,
          data: block.source.data,
        },
      };
    }

    // URL images: Gemini supports fileData but for simplicity we
    // pass as inline data. In production you might want to download & convert.
    return { text: `[Image: ${(block.source as { url: string }).url}]` };
  }

  // -------------------------------------------------------------------------
  // System Prompt
  // -------------------------------------------------------------------------

  /**
   * Converts the Anthropic system prompt to a Gemini systemInstruction content.
   */
  private convertSystemPrompt(
    system: string | AnthropicTextBlockParam[]
  ): GeminiContent {
    if (typeof system === "string") {
      return { role: "user", parts: [{ text: system }] };
    }

    const parts: GeminiPart[] = system.map((block) => ({ text: block.text }));
    return { role: "user", parts };
  }

  // -------------------------------------------------------------------------
  // Tools → Function Declarations
  // -------------------------------------------------------------------------

  /**
   * Converts Anthropic tool definitions to Gemini function declarations.
   * Sanitizes the JSON Schema to remove properties unsupported by Gemini.
   */
  private convertTools(tools: AnthropicTool[]): GeminiTool[] {
    return [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: RequestConverter.sanitizeSchema(tool.input_schema),
        })),
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Schema Sanitisation
  // -------------------------------------------------------------------------

  /**
   * Set of JSON Schema properties that Gemini's API does NOT support.
   *
   * The Gemini function-calling API only accepts a strict subset of
   * JSON Schema / OpenAPI: `type`, `description`, `properties`, `items`,
   * `required`, `enum`, `format`, `nullable`.
   *
   * Everything else (e.g. `$schema`, `additionalProperties`,
   * `exclusiveMinimum`, `const`, `anyOf`, `oneOf`, `allOf`,
   * `propertyNames`, `patternProperties`, `if`, `then`, `else`,
   * `minItems`, `maxItems`, `minimum`, `maximum`, `pattern`,
   * `default`, `title`, `$ref`, `$defs`, `definitions`, etc.)
   * must be removed or the API returns 400.
   */
  private static readonly ALLOWED_SCHEMA_KEYS = new Set([
    "type",
    "description",
    "properties",
    "items",
    "required",
    "enum",
    "format",
    "nullable",
  ]);

  /**
   * Recursively sanitises a JSON Schema object, stripping all properties
   * that the Gemini API does not accept.
   *
   * Handles:
   * - Root-level unsupported keys (`$schema`, `additionalProperties`, …)
   * - Nested `properties` values (each is a schema itself)
   * - `items` (array item schema)
   * - `anyOf` / `oneOf` / `allOf` → flattened or converted to `enum`
   *
   * @param schema - The raw JSON Schema from the Anthropic tool definition.
   * @returns A sanitised copy safe for the Gemini API.
   */
  static sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      return schema;
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(schema)) {
      if (!RequestConverter.ALLOWED_SCHEMA_KEYS.has(key)) {
        continue; // strip unsupported key
      }

      if (key === "properties" && value && typeof value === "object") {
        // Recursively sanitise each property schema
        const props: Record<string, unknown> = {};
        for (const [propName, propSchema] of Object.entries(
          value as Record<string, unknown>
        )) {
          props[propName] = RequestConverter.sanitizeSchema(
            propSchema as Record<string, unknown>
          );
        }
        sanitized.properties = props;
      } else if (key === "items" && value && typeof value === "object") {
        // Recursively sanitise array item schema
        sanitized.items = RequestConverter.sanitizeSchema(
          value as Record<string, unknown>
        );
      } else {
        sanitized[key] = value;
      }
    }

    // Handle anyOf/oneOf/allOf by trying to extract enum or simplifying
    // Gemini doesn't support these—try to flatten into a simpler type
    const anyOf = schema.anyOf ?? schema.oneOf ?? schema.allOf;
    if (Array.isArray(anyOf) && anyOf.length > 0) {
      // If all entries are simple type+const patterns, convert to enum
      const enumValues: string[] = [];
      let canEnum = true;
      for (const option of anyOf) {
        if (typeof option === "object" && option !== null) {
          const opt = option as Record<string, unknown>;
          if (opt.const !== undefined) {
            enumValues.push(String(opt.const));
          } else if (opt.enum && Array.isArray(opt.enum)) {
            enumValues.push(...(opt.enum as string[]));
          } else if (opt.type === "null") {
            // nullable type—set nullable flag
            sanitized.nullable = true;
          } else {
            canEnum = false;
          }
        }
      }
      if (canEnum && enumValues.length > 0) {
        sanitized.enum = enumValues;
        if (!sanitized.type) sanitized.type = "string";
      }
    }

    return sanitized;
  }

  // -------------------------------------------------------------------------
  // Tool Choice → Function Calling Config
  // -------------------------------------------------------------------------

  /**
   * Converts Anthropic tool_choice to Gemini functionCallingConfig.
   */
  private convertToolChoice(
    choice: AnthropicToolChoice,
    tools?: AnthropicTool[]
  ): GeminiToolConfig {
    let mode: GeminiFunctionCallingMode;
    let allowedFunctionNames: string[] | undefined;

    switch (choice.type) {
      case "auto":
        mode = "AUTO";
        break;
      case "any":
        mode = "ANY";
        break;
      case "none":
        mode = "NONE";
        break;
      case "tool":
        mode = "ANY";
        allowedFunctionNames = choice.name ? [choice.name] : undefined;
        break;
      default:
        mode = "AUTO";
    }

    return {
      functionCallingConfig: {
        mode,
        ...(allowedFunctionNames ? { allowedFunctionNames } : {}),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Generation Config
  // -------------------------------------------------------------------------

  /**
   * Builds the Gemini generationConfig from Anthropic request parameters.
   */
  private buildGenerationConfig(
    request: AnthropicMessagesRequest,
    capabilities: ModelCapabilities
  ): GeminiGenerationConfig {
    const config: GeminiGenerationConfig = {};

    // Basic parameters
    if (request.temperature !== undefined) {
      config.temperature = request.temperature;
    }
    if (request.top_p !== undefined) {
      config.topP = request.top_p;
    }
    if (request.top_k !== undefined) {
      config.topK = request.top_k;
    }
    if (request.max_tokens !== undefined) {
      config.maxOutputTokens = Math.min(
        request.max_tokens,
        capabilities.maxOutputTokens
      );
    }
    if (request.stop_sequences) {
      config.stopSequences = request.stop_sequences;
    }

    // Thinking configuration
    config.thinkingConfig = this.buildThinkingConfig(
      request.thinking,
      capabilities
    );

    return config;
  }

  /**
   * Builds the Gemini ThinkingConfig from Anthropic thinking parameters.
   *
   * For Gemini 3 models, uses `thinkingLevel` (MINIMAL, LOW, MEDIUM, HIGH).
   * For Gemini 2.5 models, uses `thinkingBudget`.
   */
  private buildThinkingConfig(
    thinking: AnthropicThinkingConfig | undefined,
    capabilities: ModelCapabilities
  ): GeminiThinkingConfig {
    const config: GeminiThinkingConfig = {
      includeThoughts: true,
    };

    if (capabilities.isGemini3) {
      // Gemini 3: use thinkingLevel
      if (thinking?.type === "disabled") {
        // Gemini 3 Pro cannot disable thinking
        // Gemini 3 Flash can use MINIMAL (may still think)
        config.thinkingLevel = "MINIMAL";
      } else if (thinking?.budget_tokens) {
        // Map budget to level heuristically
        config.thinkingLevel = this.budgetToLevel(thinking.budget_tokens);
      } else {
        config.thinkingLevel =
          capabilities.defaultThinkingLevel ?? "HIGH";
      }
    } else if (capabilities.supportsThinking) {
      // Gemini 2.5: use thinkingBudget
      if (thinking?.type === "disabled") {
        config.thinkingBudget = 0;
      } else if (thinking?.budget_tokens) {
        config.thinkingBudget = thinking.budget_tokens;
      }
      // else let Gemini use dynamic thinking
    }

    return config;
  }

  /**
   * Maps an Anthropic thinking budget (in tokens) to a Gemini 3 thinking level.
   */
  private budgetToLevel(budget: number): GeminiThinkingLevel {
    if (budget <= 1024) return "MINIMAL";
    if (budget <= 4096) return "LOW";
    if (budget <= 16384) return "MEDIUM";
    return "HIGH";
  }
}
