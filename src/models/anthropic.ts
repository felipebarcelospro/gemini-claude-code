/**
 * Anthropic Messages API type definitions.
 *
 * These types represent the full request/response contract for the
 * Anthropic Messages API (`POST /v1/messages`), including streaming
 * Server-Sent Events and extended thinking support.
 *
 * @see https://docs.anthropic.com/en/api/messages
 * @see https://docs.anthropic.com/en/api/messages-streaming
 */

// ---------------------------------------------------------------------------
// Content block types (used in both requests and responses)
// ---------------------------------------------------------------------------

/** A plain text content block. */
export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

/** A text content block parameter (request-side, supports cache_control). */
export interface AnthropicTextBlockParam {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
}

/** An image content block parameter. */
export interface AnthropicImageBlockParam {
  type: "image";
  source: AnthropicBase64ImageSource | AnthropicUrlImageSource;
  cache_control?: AnthropicCacheControl;
}

/** Base64-encoded image source. */
export interface AnthropicBase64ImageSource {
  type: "base64";
  media_type: string;
  data: string;
}

/** URL-based image source. */
export interface AnthropicUrlImageSource {
  type: "url";
  url: string;
}

/** A tool-use content block (model output). */
export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A tool-result content block (user input). */
export interface AnthropicToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;
  content?: string | AnthropicContentBlockParam[];
  is_error?: boolean;
  cache_control?: AnthropicCacheControl;
}

/** Extended thinking content block (model output). */
export interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

/** Redacted thinking content block (model output). */
export interface AnthropicRedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}

/** Cache control configuration. */
export interface AnthropicCacheControl {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

/** Union of all content block types in a request message. */
export type AnthropicContentBlockParam =
  | AnthropicTextBlockParam
  | AnthropicImageBlockParam
  | AnthropicToolUseBlock
  | AnthropicToolResultBlockParam;

/** Union of all content block types in a response message. */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicThinkingBlock
  | AnthropicRedactedThinkingBlock;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** A single message in the conversational history. */
export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlockParam[];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** A tool definition sent in the request. */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  cache_control?: AnthropicCacheControl;
}

/** How the model should choose which tool to use. */
export interface AnthropicToolChoice {
  type: "auto" | "any" | "tool" | "none";
  name?: string;
  disable_parallel_tool_use?: boolean;
}

// ---------------------------------------------------------------------------
// Thinking configuration
// ---------------------------------------------------------------------------

/** Configuration for extended thinking. */
export interface AnthropicThinkingConfig {
  type: "enabled" | "disabled";
  budget_tokens?: number;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** The body of a `POST /v1/messages` request. */
export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string | AnthropicTextBlockParam[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  thinking?: AnthropicThinkingConfig;
  metadata?: { user_id?: string };
}

// ---------------------------------------------------------------------------
// Response (non-streaming)
// ---------------------------------------------------------------------------

/** Token usage information. */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** The response from `POST /v1/messages` (non-streaming). */
export interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

// ---------------------------------------------------------------------------
// Streaming SSE event types
// ---------------------------------------------------------------------------

/** Sent at the start of a streaming response. */
export interface AnthropicMessageStartEvent {
  type: "message_start";
  message: AnthropicMessagesResponse;
}

/** Sent when a new content block begins. */
export interface AnthropicContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: AnthropicContentBlock;
}

/** Text delta for a content block. */
export interface AnthropicTextDelta {
  type: "text_delta";
  text: string;
}

/** Input JSON delta for a tool_use content block. */
export interface AnthropicInputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

/** Thinking delta for a thinking content block. */
export interface AnthropicThinkingDelta {
  type: "thinking_delta";
  thinking: string;
}

/** Signature delta (sent before content_block_stop for thinking blocks). */
export interface AnthropicSignatureDelta {
  type: "signature_delta";
  signature: string;
}

/** Union of all delta types. */
export type AnthropicDelta =
  | AnthropicTextDelta
  | AnthropicInputJsonDelta
  | AnthropicThinkingDelta
  | AnthropicSignatureDelta;

/** Sent for each incremental update to a content block. */
export interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: AnthropicDelta;
}

/** Sent when a content block is complete. */
export interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

/** Sent for top-level updates to the message (e.g. stop_reason). */
export interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
    stop_sequence: string | null;
  };
  usage: { output_tokens: number };
}

/** Sent when the message stream is complete. */
export interface AnthropicMessageStopEvent {
  type: "message_stop";
}

/** Keep-alive ping event. */
export interface AnthropicPingEvent {
  type: "ping";
}

/** Union of all streaming event types. */
export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent;
