/**
 * Gemini → Anthropic response converter.
 *
 * Transforms a Gemini `GenerateContentResponse` into an Anthropic
 * `MessagesResponse`. This is the outbound half of the proxy:
 *
 *   Gemini response  →  [this converter]  →  Anthropic response  →  Claude Code
 *
 * Key conversion responsibilities:
 * - Candidate parts → Anthropic content blocks
 * - Function calls → tool_use blocks (with unique IDs)
 * - Thinking parts → thinking blocks
 * - Finish reason mapping
 * - Usage metadata mapping
 * - Thought signature extraction and storage
 */

import type {
  AnthropicMessagesResponse,
  AnthropicContentBlock,
  AnthropicUsage,
} from "../models/anthropic";
import type {
  GeminiGenerateContentResponse,
  GeminiPart,
  GeminiFinishReason,
} from "../models/gemini";
import { ThoughtSignatureService } from "../services/thought-signature";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique ID for a tool_use block.
 * Matches the format Claude uses: `toolu_<alphanumeric>`.
 */
function generateToolUseId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "toolu_";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generates a unique message ID matching Anthropic's format.
 */
function generateMessageId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "msg_";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ---------------------------------------------------------------------------
// ResponseConverter
// ---------------------------------------------------------------------------

/**
 * Converts Gemini `GenerateContentResponse` objects into Anthropic
 * `MessagesResponse` format.
 *
 * Also handles thought signature extraction as a side-effect, storing
 * signatures in the provided `ThoughtSignatureService` for use in
 * subsequent turns.
 */
export class ResponseConverter {
  private readonly thoughtSignatures: ThoughtSignatureService;
  private readonly modelName: string;

  constructor(thoughtSignatures: ThoughtSignatureService, modelName: string) {
    this.thoughtSignatures = thoughtSignatures;
    this.modelName = modelName;
  }

  /**
   * Converts a complete (non-streaming) Gemini response to Anthropic format.
   *
   * @param response - The Gemini response.
   * @returns The equivalent Anthropic response.
   */
  convert(response: GeminiGenerateContentResponse): AnthropicMessagesResponse {
    const candidate = response.candidates?.[0];
    if (!candidate) {
      return this.buildEmptyResponse();
    }

    const content = this.convertParts(candidate.content?.parts ?? []);
    const stopReason = this.convertFinishReason(candidate.finishReason, content);
    const usage = this.convertUsage(response);

    return {
      id: generateMessageId(),
      type: "message",
      role: "assistant",
      content,
      model: this.modelName,
      stop_reason: stopReason,
      stop_sequence: null,
      usage,
    };
  }

  // -------------------------------------------------------------------------
  // Parts → Content Blocks
  // -------------------------------------------------------------------------

  /**
   * Converts an array of Gemini parts into Anthropic content blocks.
   *
   * Also extracts and stores thought signatures encountered in the parts.
   */
  convertParts(parts: GeminiPart[]): AnthropicContentBlock[] {
    const blocks: AnthropicContentBlock[] = [];

    for (const part of parts) {
      // Extract thought signature (side-effect)
      const sig = (part as { thoughtSignature?: string }).thoughtSignature;

      if ("text" in part) {
        const textPart = part as { text: string; thought?: boolean; thoughtSignature?: string };

        // Skip empty text parts (may contain only a signature)
        if (!textPart.text && sig) {
          // Pure signature carrier—just store the signature
          this.thoughtSignatures.storeTextSignature(sig);
          continue;
        }

        if (textPart.thought) {
          // Thinking/reasoning content
          blocks.push({
            type: "thinking",
            thinking: textPart.text,
            signature: sig ?? "",
          });
        } else {
          if (textPart.text) {
            blocks.push({
              type: "text",
              text: textPart.text,
            });
          }
        }

        if (sig) {
          this.thoughtSignatures.storeTextSignature(sig);
        }
      } else if ("functionCall" in part) {
        const fcPart = part as {
          functionCall: { name: string; args: Record<string, unknown> };
          thoughtSignature?: string;
        };

        blocks.push({
          type: "tool_use",
          id: generateToolUseId(),
          name: fcPart.functionCall.name,
          input: fcPart.functionCall.args ?? {},
        });

        if (sig) {
          this.thoughtSignatures.storeTextSignature(sig);
        }
      }
      // functionResponse and inlineData parts are not expected in
      // model responses, so we skip them.
    }

    // Ensure at least one text block if empty
    if (blocks.length === 0) {
      blocks.push({ type: "text", text: "" });
    }

    return blocks;
  }

  // -------------------------------------------------------------------------
  // Finish Reason
  // -------------------------------------------------------------------------

  /**
   * Maps a Gemini finish reason to an Anthropic stop reason.
   */
  convertFinishReason(
    reason: GeminiFinishReason | undefined,
    content: AnthropicContentBlock[]
  ): AnthropicMessagesResponse["stop_reason"] {
    // If the response contains tool_use blocks, override to "tool_use"
    const hasToolUse = content.some((b) => b.type === "tool_use");
    if (hasToolUse) return "tool_use";

    switch (reason) {
      case "STOP":
        return "end_turn";
      case "MAX_TOKENS":
        return "max_tokens";
      default:
        return "end_turn";
    }
  }

  // -------------------------------------------------------------------------
  // Usage
  // -------------------------------------------------------------------------

  /**
   * Converts Gemini usage metadata to Anthropic usage format.
   */
  convertUsage(response: GeminiGenerateContentResponse): AnthropicUsage {
    const meta = response.usageMetadata;
    return {
      input_tokens: meta?.promptTokenCount ?? 0,
      output_tokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Builds an empty response for edge cases (e.g. blocked by safety).
   */
  private buildEmptyResponse(): AnthropicMessagesResponse {
    return {
      id: generateMessageId(),
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "" }],
      model: this.modelName,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
}
