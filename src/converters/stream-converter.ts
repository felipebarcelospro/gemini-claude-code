/**
 * Gemini Streaming → Anthropic SSE stream converter.
 *
 * Transforms the Gemini `streamGenerateContent` NDJSON response stream
 * into Anthropic-compatible Server-Sent Events (SSE).
 *
 * Gemini streaming returns JSON objects (one per chunk), while Anthropic
 * streaming uses SSE with specific event types:
 *   message_start → content_block_start → content_block_delta* →
 *   content_block_stop → message_delta → message_stop
 *
 * This converter handles:
 * - Buffering JSON chunks from the Gemini NDJSON stream
 * - Emitting proper SSE event sequences
 * - Tracking content block indices across chunks
 * - Handling thinking blocks and tool_use blocks
 * - Thought signature extraction during streaming
 */

import type {
  AnthropicContentBlock,
  AnthropicStreamEvent,
  AnthropicUsage,
} from "../models/anthropic";
import type {
  GeminiGenerateContentResponse,
  GeminiPart,
} from "../models/gemini";
import { ThoughtSignatureService } from "../services/thought-signature";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateToolUseId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "toolu_";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateMessageId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "msg_";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ---------------------------------------------------------------------------
// StreamConverter
// ---------------------------------------------------------------------------

/**
 * Converts a Gemini streaming response into Anthropic SSE events.
 *
 * The converter maintains internal state to track:
 * - The current content block index
 * - Whether we're inside a thinking block, text block, or tool_use block
 * - Accumulated input JSON for tool_use blocks
 * - Token usage across chunks
 *
 * Usage:
 * ```ts
 * const converter = new StreamConverter("model-name", sigService);
 * const stream = converter.convertStream(geminiResponse);
 * // stream is a ReadableStream<Uint8Array> of SSE data
 * ```
 */
export class StreamConverter {
  private readonly modelName: string;
  private readonly thoughtSignatures: ThoughtSignatureService;
  private readonly messageId: string;

  /** Current content block index in the output. */
  private blockIndex = 0;

  /** Whether the message_start event has been emitted. */
  private messageStarted = false;

  /** Whether we have an open content block that needs closing. */
  private currentBlockType: "text" | "thinking" | "tool_use" | null = null;

  /** Accumulated text for the current thinking block's signature. */
  private currentThinkingSignature = "";

  /** Whether any tool_use blocks have been emitted. */
  private hasEmittedToolUse = false;

  /** Total input/output token counts. */
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(
    modelName: string,
    thoughtSignatures: ThoughtSignatureService
  ) {
    this.modelName = modelName;
    this.thoughtSignatures = thoughtSignatures;
    this.messageId = generateMessageId();
  }

  /**
   * Converts a Gemini streaming HTTP response into an Anthropic SSE stream.
   *
   * @param geminiResponse - The raw fetch Response from Gemini's
   *                         streamGenerateContent endpoint.
   * @returns A ReadableStream of SSE-formatted Uint8Array chunks.
   */
  convertStream(geminiResponse: Response): ReadableStream<Uint8Array> {
    const reader = geminiResponse.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    return new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Process any remaining buffer
              if (buffer.trim()) {
                self.processBufferedJson(buffer, controller, encoder);
              }

              // Close any open block
              self.closeCurrentBlock(controller, encoder);

              // Emit message_delta and message_stop
              self.emitMessageEnd(controller, encoder);

              controller.close();
              return;
            }

            buffer += decoder.decode(value, { stream: true });

            // Gemini streaming can return:
            // 1. NDJSON (one JSON object per line)
            // 2. Array of JSON objects wrapped in [ ... ]
            // We handle both formats.

            // Try to parse complete JSON objects from the buffer
            self.processBuffer(controller, encoder, buffer);

            // Keep only unparsed remainder
            const lastCompleteIndex = self.findLastCompleteJson(buffer);
            if (lastCompleteIndex >= 0) {
              buffer = buffer.substring(lastCompleteIndex);
            }
          }
        } catch (error) {
          // Emit error event in SSE format
          const errorEvent = self.formatSSE("error", {
            type: "error",
            error: {
              type: "api_error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
          controller.enqueue(encoder.encode(errorEvent));
          controller.close();
        }
      },

      cancel() {
        reader.cancel();
      },
    });
  }

  // -------------------------------------------------------------------------
  // Buffer processing
  // -------------------------------------------------------------------------

  /**
   * Processes the accumulated buffer, extracting and handling complete
   * JSON objects.
   *
   * When using `alt=sse`, Gemini returns data in SSE format:
   * ```
   * data: {"candidates": [...]}
   *
   * data: {"candidates": [...]}
   * ```
   *
   * We also handle NDJSON and array-wrapped formats as fallbacks.
   */
  private processBuffer(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    buffer: string
  ): void {
    // Handle SSE format (data: {json}) — this is what Gemini returns with alt=sse
    const lines = buffer.split("\n");
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // SSE data lines
      if (trimmedLine.startsWith("data: ")) {
        const jsonStr = trimmedLine.substring(6).trim();
        if (jsonStr) {
          this.processBufferedJson(jsonStr, controller, encoder);
        }
        continue;
      }

      // Skip SSE event type lines and empty markers
      if (trimmedLine.startsWith("event:")) continue;
      if (trimmedLine === "[" || trimmedLine === "]" || trimmedLine === ",") continue;

      // Handle array-wrapped streaming (Gemini sometimes wraps in [])
      if (trimmedLine.startsWith("[")) {
        this.extractJsonFromArray(trimmedLine, controller, encoder);
        continue;
      }

      // Fallback: try as raw JSON (NDJSON format)
      this.processBufferedJson(trimmedLine, controller, encoder);
    }
  }

  /**
   * Extracts JSON objects from an array-format streaming response.
   */
  private extractJsonFromArray(
    text: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    // Remove outer brackets and split on },{ pattern
    let inner = text;
    if (inner.startsWith("[")) inner = inner.substring(1);
    if (inner.endsWith("]")) inner = inner.substring(0, inner.length - 1);

    // Use a simple regex-free approach: find complete JSON objects
    let depth = 0;
    let start = -1;

    for (let i = 0; i < inner.length; i++) {
      const char = inner[i];
      if (char === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          const jsonStr = inner.substring(start, i + 1).trim();
          this.processBufferedJson(jsonStr, controller, encoder);
          start = -1;
        }
      }
    }
  }

  /**
   * Finds the index of the last character of the last complete JSON object
   * in the buffer.
   */
  private findLastCompleteJson(buffer: string): number {
    let lastIndex = -1;
    let depth = 0;

    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === "{") depth++;
      else if (buffer[i] === "}") {
        depth--;
        if (depth === 0) lastIndex = i + 1;
      }
    }

    return lastIndex;
  }

  /**
   * Parses a JSON string as a Gemini response chunk and emits the
   * corresponding Anthropic SSE events.
   */
  private processBufferedJson(
    jsonStr: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    // Clean up common artifacts
    let cleaned = jsonStr.trim();
    if (cleaned.startsWith(",")) cleaned = cleaned.substring(1).trim();
    if (!cleaned || cleaned === "[" || cleaned === "]") return;

    try {
      const chunk: GeminiGenerateContentResponse = JSON.parse(cleaned);
      this.processChunk(chunk, controller, encoder);
    } catch {
      // Incomplete JSON – will be retried with more data
    }
  }

  // -------------------------------------------------------------------------
  // Chunk processing → SSE events
  // -------------------------------------------------------------------------

  /**
   * Processes a single Gemini response chunk and emits Anthropic SSE events.
   */
  private processChunk(
    chunk: GeminiGenerateContentResponse,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    // Emit message_start on first chunk
    if (!this.messageStarted) {
      this.emitMessageStart(chunk, controller, encoder);
      this.messageStarted = true;
    }

    // Update usage
    if (chunk.usageMetadata) {
      this.inputTokens = chunk.usageMetadata.promptTokenCount ?? this.inputTokens;
      this.outputTokens =
        (chunk.usageMetadata.candidatesTokenCount ?? 0) +
        (chunk.usageMetadata.thoughtsTokenCount ?? 0);
    }

    // Process parts
    const candidate = chunk.candidates?.[0];
    if (!candidate?.content?.parts) return;

    for (const part of candidate.content.parts) {
      this.processPart(part, controller, encoder);
    }
  }

  /**
   * Processes a single part from a streaming chunk.
   */
  private processPart(
    part: GeminiPart,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    // Extract thought signature
    const sig = (part as { thoughtSignature?: string }).thoughtSignature;
    if (sig) {
      this.thoughtSignatures.storeTextSignature(sig);
    }

    if ("text" in part) {
      const textPart = part as { text: string; thought?: boolean; thoughtSignature?: string };

      // Skip empty text parts that are just signature carriers
      if (!textPart.text && sig) return;

      if (textPart.thought) {
        // Thinking content
        this.handleThinkingDelta(textPart.text, sig, controller, encoder);
      } else {
        // Regular text
        if (textPart.text) {
          this.handleTextDelta(textPart.text, controller, encoder);
        }
      }
    } else if ("functionCall" in part) {
      const fcPart = part as {
        functionCall: { name: string; args: Record<string, unknown> };
      };
      this.handleToolUse(fcPart.functionCall, controller, encoder);
    }
  }

  // -------------------------------------------------------------------------
  // Content block handlers
  // -------------------------------------------------------------------------

  /**
   * Handles a text delta from the stream.
   */
  private handleTextDelta(
    text: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    if (this.currentBlockType !== "text") {
      this.closeCurrentBlock(controller, encoder);
      // Start a new text block
      this.emitEvent(
        controller,
        encoder,
        "content_block_start",
        {
          type: "content_block_start",
          index: this.blockIndex,
          content_block: { type: "text", text: "" },
        }
      );
      this.currentBlockType = "text";
    }

    // Emit text delta
    this.emitEvent(controller, encoder, "content_block_delta", {
      type: "content_block_delta",
      index: this.blockIndex,
      delta: { type: "text_delta", text },
    });
  }

  /**
   * Handles a thinking delta from the stream.
   */
  private handleThinkingDelta(
    thinking: string,
    signature: string | undefined,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    if (this.currentBlockType !== "thinking") {
      this.closeCurrentBlock(controller, encoder);
      // Start a new thinking block
      this.emitEvent(
        controller,
        encoder,
        "content_block_start",
        {
          type: "content_block_start",
          index: this.blockIndex,
          content_block: { type: "thinking", thinking: "" },
        }
      );
      this.currentBlockType = "thinking";
      this.currentThinkingSignature = "";
    }

    // Track signature for the closing signature_delta
    if (signature) {
      this.currentThinkingSignature = signature;
    }

    // Emit thinking delta
    if (thinking) {
      this.emitEvent(controller, encoder, "content_block_delta", {
        type: "content_block_delta",
        index: this.blockIndex,
        delta: { type: "thinking_delta", thinking },
      });
    }
  }

  /**
   * Handles a tool_use (function call) from the stream.
   * Tool use in streaming typically comes as a complete part.
   */
  private handleToolUse(
    functionCall: { name: string; args: Record<string, unknown> },
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    this.closeCurrentBlock(controller, encoder);

    const toolUseId = generateToolUseId();
    this.hasEmittedToolUse = true;

    // Start tool_use block
    this.emitEvent(controller, encoder, "content_block_start", {
      type: "content_block_start",
      index: this.blockIndex,
      content_block: {
        type: "tool_use",
        id: toolUseId,
        name: functionCall.name,
        input: {},
      },
    });

    // Emit the input as a single JSON delta
    const inputJson = JSON.stringify(functionCall.args ?? {});
    this.emitEvent(controller, encoder, "content_block_delta", {
      type: "content_block_delta",
      index: this.blockIndex,
      delta: {
        type: "input_json_delta",
        partial_json: inputJson,
      },
    });

    // Close the tool_use block
    this.emitEvent(controller, encoder, "content_block_stop", {
      type: "content_block_stop",
      index: this.blockIndex,
    });

    this.blockIndex++;
    this.currentBlockType = null;
  }

  // -------------------------------------------------------------------------
  // Block lifecycle
  // -------------------------------------------------------------------------

  /**
   * Closes the currently open content block, if any.
   */
  private closeCurrentBlock(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    if (this.currentBlockType === null) return;

    // For thinking blocks, emit signature_delta before closing
    if (this.currentBlockType === "thinking" && this.currentThinkingSignature) {
      this.emitEvent(controller, encoder, "content_block_delta", {
        type: "content_block_delta",
        index: this.blockIndex,
        delta: {
          type: "signature_delta",
          signature: this.currentThinkingSignature,
        },
      });
    }

    this.emitEvent(controller, encoder, "content_block_stop", {
      type: "content_block_stop",
      index: this.blockIndex,
    });

    this.blockIndex++;
    this.currentBlockType = null;
    this.currentThinkingSignature = "";
  }

  // -------------------------------------------------------------------------
  // Message lifecycle events
  // -------------------------------------------------------------------------

  /**
   * Emits the message_start event.
   */
  private emitMessageStart(
    chunk: GeminiGenerateContentResponse,
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    this.emitEvent(controller, encoder, "message_start", {
      type: "message_start",
      message: {
        id: this.messageId,
        type: "message",
        role: "assistant",
        content: [],
        model: this.modelName,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: chunk.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: 0,
        },
      },
    });

    // Emit initial ping
    this.emitEvent(controller, encoder, "ping", { type: "ping" });
  }

  /**
   * Emits the message_delta and message_stop events.
   */
  private emitMessageEnd(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder
  ): void {
    // If no blocks were emitted, add an empty text block
    if (this.blockIndex === 0 && !this.messageStarted) {
      this.emitMessageStart(
        { candidates: [], usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 } },
        controller,
        encoder
      );
      this.emitEvent(controller, encoder, "content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      this.emitEvent(controller, encoder, "content_block_stop", {
        type: "content_block_stop",
        index: 0,
      });
    }

    // Determine stop reason: tool_use if any tool_use blocks were emitted
    const stopReason = this.hasEmittedToolUse ? "tool_use" : "end_turn";

    this.emitEvent(controller, encoder, "message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage: {
        output_tokens: this.outputTokens,
      },
    });

    this.emitEvent(controller, encoder, "message_stop", {
      type: "message_stop",
    });
  }

  // -------------------------------------------------------------------------
  // SSE formatting
  // -------------------------------------------------------------------------

  /**
   * Emits a single SSE event to the controller.
   */
  private emitEvent(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    eventType: string,
    data: unknown
  ): void {
    const sse = this.formatSSE(eventType, data);
    controller.enqueue(encoder.encode(sse));
  }

  /**
   * Formats data as an SSE event string.
   */
  private formatSSE(eventType: string, data: unknown): string {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}
