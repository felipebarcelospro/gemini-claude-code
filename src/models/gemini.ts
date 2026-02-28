/**
 * Google Gemini API type definitions.
 *
 * These types represent the request/response contract for the Gemini
 * `generateContent` and `streamGenerateContent` REST endpoints.
 *
 * Key areas covered:
 * - Content, Parts, and Roles
 * - Function calling (declarations, calls, responses)
 * - Thought signatures (critical for Gemini 3 models)
 * - Generation configuration (including ThinkingConfig)
 * - Usage metadata and candidate responses
 *
 * @see https://ai.google.dev/api/generate-content
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 */

// ---------------------------------------------------------------------------
// Parts – atomic pieces within a Content message
// ---------------------------------------------------------------------------

/** A plain-text part. */
export interface GeminiTextPart {
  text: string;
  thought?: boolean;
  thoughtSignature?: string;
}

/** An inline binary data part (e.g. images). */
export interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string;
    data: string; // base64-encoded
  };
  thoughtSignature?: string;
}

/** A function-call part emitted by the model. */
export interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
  thoughtSignature?: string;
}

/** A function-response part sent by the client. */
export interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
  };
}

/** Union of all Gemini part types. */
export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

// ---------------------------------------------------------------------------
// Content – a single conversational turn
// ---------------------------------------------------------------------------

/** A single message/turn in the conversation. */
export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

// ---------------------------------------------------------------------------
// Function declarations (tools)
// ---------------------------------------------------------------------------

/** JSON Schema subset used by Gemini for function parameters. */
export interface GeminiSchema {
  type: string;
  description?: string;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
  enum?: string[];
  format?: string;
}

/** A single function declaration. */
export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: GeminiSchema | Record<string, unknown>;
}

/** A tool object that wraps function declarations. */
export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[];
}

/** Function-calling mode. */
export type GeminiFunctionCallingMode = "AUTO" | "ANY" | "NONE";

/** Fine-grained function-calling configuration. */
export interface GeminiFunctionCallingConfig {
  mode: GeminiFunctionCallingMode;
  allowedFunctionNames?: string[];
}

/** Tool configuration at request level. */
export interface GeminiToolConfig {
  functionCallingConfig?: GeminiFunctionCallingConfig;
}

// ---------------------------------------------------------------------------
// Generation configuration
// ---------------------------------------------------------------------------

/** Thinking level enum for Gemini 3 models. */
export type GeminiThinkingLevel =
  | "THINKING_LEVEL_UNSPECIFIED"
  | "MINIMAL"
  | "LOW"
  | "MEDIUM"
  | "HIGH";

/** Configuration for thinking/reasoning behaviour. */
export interface GeminiThinkingConfig {
  includeThoughts?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: GeminiThinkingLevel;
}

/** Generation configuration parameters. */
export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
  responseMimeType?: string;
  responseSchema?: GeminiSchema;
  thinkingConfig?: GeminiThinkingConfig;
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

/** Harm category identifiers. */
export type GeminiHarmCategory =
  | "HARM_CATEGORY_HARASSMENT"
  | "HARM_CATEGORY_HATE_SPEECH"
  | "HARM_CATEGORY_SEXUALLY_EXPLICIT"
  | "HARM_CATEGORY_DANGEROUS_CONTENT"
  | "HARM_CATEGORY_CIVIC_INTEGRITY";

/** Threshold for blocking content. */
export type GeminiHarmBlockThreshold =
  | "BLOCK_NONE"
  | "BLOCK_LOW_AND_ABOVE"
  | "BLOCK_MEDIUM_AND_ABOVE"
  | "BLOCK_ONLY_HIGH";

/** A single safety setting entry. */
export interface GeminiSafetySetting {
  category: GeminiHarmCategory;
  threshold: GeminiHarmBlockThreshold;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** The body of a Gemini `generateContent` / `streamGenerateContent` request. */
export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  tools?: GeminiTool[];
  toolConfig?: GeminiToolConfig;
  safetySettings?: GeminiSafetySetting[];
  systemInstruction?: GeminiContent;
  generationConfig?: GeminiGenerationConfig;
  cachedContent?: string;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/** Finish reasons for a generated candidate. */
export type GeminiFinishReason =
  | "FINISH_REASON_UNSPECIFIED"
  | "STOP"
  | "MAX_TOKENS"
  | "SAFETY"
  | "RECITATION"
  | "OTHER";

/** A safety rating attached to a candidate. */
export interface GeminiSafetyRating {
  category: GeminiHarmCategory;
  probability: string;
}

/** A single generated candidate. */
export interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: GeminiFinishReason;
  safetyRatings?: GeminiSafetyRating[];
  index?: number;
}

/** Token usage statistics. */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
}

/** The response from `generateContent` / each chunk of `streamGenerateContent`. */
export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
  responseId?: string;
}
