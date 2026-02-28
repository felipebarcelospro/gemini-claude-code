/**
 * Model configuration and name mapping between Anthropic and Gemini APIs.
 *
 * This module is responsible for:
 * - Mapping Anthropic model identifiers to their Gemini equivalents.
 * - Determining capabilities of each model (thinking support, etc.).
 * - Providing sensible defaults for generation parameters.
 */

// ---------------------------------------------------------------------------
// Model capability metadata
// ---------------------------------------------------------------------------

/** Describes the capabilities and configuration of a mapped model. */
export interface ModelCapabilities {
  /** The Gemini model identifier (e.g. "gemini-3.1-pro-preview"). */
  geminiModel: string;

  /** Whether the model supports thinking (internal reasoning). */
  supportsThinking: boolean;

  /** Whether the model is part of the Gemini 3 family (requires strict thought signatures). */
  isGemini3: boolean;

  /** Default thinking level for Gemini 3 models. */
  defaultThinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

  /** Maximum output tokens the model supports. */
  maxOutputTokens: number;
}

// ---------------------------------------------------------------------------
// Default model for Claude → Gemini mapping
// ---------------------------------------------------------------------------

/**
 * The default Gemini model used when an incoming Claude model name
 * doesn't match any explicit Gemini model in the registry.
 */
const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

// ---------------------------------------------------------------------------
// Gemini 3 Flash capabilities (shared reference)
// ---------------------------------------------------------------------------

const GEMINI_3_FLASH_CAPS: ModelCapabilities = {
  geminiModel: "gemini-3-flash-preview",
  supportsThinking: true,
  isGemini3: true,
  defaultThinkingLevel: "HIGH",
  maxOutputTokens: 65_536,
};

const GEMINI_31_PRO_CAPS: ModelCapabilities = {
  geminiModel: "gemini-3.1-pro-preview",
  supportsThinking: true,
  isGemini3: true,
  defaultThinkingLevel: "HIGH",
  maxOutputTokens: 65_536,
};

// ---------------------------------------------------------------------------
// Model mapping registry
// ---------------------------------------------------------------------------

/**
 * Maps Anthropic-style model identifiers to Gemini model configurations.
 *
 * Claude Code sends model names like `claude-sonnet-4-6`, `claude-opus-4-6`,
 * etc. We intercept these and route them to the configured Gemini model.
 *
 * Sub-agents (Teams, Agent tool) may also use model names like
 * `claude-haiku-4-5-20251001` — these all need to be caught.
 */
const MODEL_REGISTRY: Record<string, ModelCapabilities> = {
  // ── Gemini 3.1 Pro ──────────────────────────────────────────────────────
  "gemini-3.1-pro": GEMINI_31_PRO_CAPS,
  "gemini-3.1-pro-preview": GEMINI_31_PRO_CAPS,

  // ── Gemini 3.0 Flash ────────────────────────────────────────────────────
  "gemini-3.0-flash": GEMINI_3_FLASH_CAPS,
  "gemini-3-flash-preview": GEMINI_3_FLASH_CAPS,

  // ── Gemini 2.5 Pro ──────────────────────────────────────────────────────
  "gemini-2.5-pro": {
    geminiModel: "gemini-2.5-pro-preview-06-05",
    supportsThinking: true,
    isGemini3: false,
    maxOutputTokens: 65_536,
  },

  // ── Gemini 2.5 Flash ────────────────────────────────────────────────────
  "gemini-flash-latest": {
    geminiModel: "gemini-flash-latest",
    supportsThinking: true,
    isGemini3: false,
    maxOutputTokens: 65_536,
  },

  // ── Gemini 2.0 Flash ────────────────────────────────────────────────────
  "gemini-2.0-flash": {
    geminiModel: "gemini-2.0-flash",
    supportsThinking: false,
    isGemini3: false,
    maxOutputTokens: 8_192,
  },

  // ── Claude model aliases → Gemini 3 Flash (default) ─────────────────────
  // These are sent by Claude Code, Teams, Sub-agents, etc.
  "claude-sonnet-4-6": GEMINI_3_FLASH_CAPS,
  "claude-sonnet-4-20250514": GEMINI_3_FLASH_CAPS,
  "claude-opus-4-6": GEMINI_3_FLASH_CAPS,
  "claude-opus-4-20250414": GEMINI_3_FLASH_CAPS,
  "claude-3-5-sonnet-20241022": GEMINI_3_FLASH_CAPS,
  "claude-3-5-sonnet-latest": GEMINI_3_FLASH_CAPS,
  "claude-3-5-haiku-20241022": GEMINI_3_FLASH_CAPS,
  "claude-3-5-haiku-latest": GEMINI_3_FLASH_CAPS,
  "claude-haiku-4-5-20251001": GEMINI_3_FLASH_CAPS,
  "claude-3-opus-20240229": GEMINI_3_FLASH_CAPS,
  "claude-3-sonnet-20240229": GEMINI_3_FLASH_CAPS,
  "claude-3-haiku-20240307": GEMINI_3_FLASH_CAPS,
};

// ---------------------------------------------------------------------------
// ModelConfigService
// ---------------------------------------------------------------------------

/**
 * Service class for resolving and configuring model mappings.
 *
 * Supports runtime overrides so users can route any Anthropic model name
 * to a specific Gemini model via CLI flags or environment variables.
 */
export class ModelConfigService {
  private readonly overrides: Map<string, string>;

  constructor(overrides?: Record<string, string>) {
    this.overrides = new Map(Object.entries(overrides ?? {}));
  }

  /**
   * Resolves an incoming model name (potentially Anthropic-style) to its
   * Gemini model capabilities.
   *
   * Resolution order:
   * 1. Explicit CLI/env overrides.
   * 2. Direct match in the registry.
   * 3. Claude model prefix detection (`claude-*` → default Gemini).
   * 4. Fallback: treat the name as a literal Gemini model identifier.
   *
   * @param requestedModel - The model name from the Anthropic request.
   * @returns The resolved capabilities.
   */
  resolve(requestedModel: string): ModelCapabilities {
    // 1. Check overrides
    const overriddenGeminiModel = this.overrides.get(requestedModel);
    if (overriddenGeminiModel) {
      // Try to find it in registry for capabilities
      const found = Object.values(MODEL_REGISTRY).find(
        (c) => c.geminiModel === overriddenGeminiModel
      );
      if (found) return found;

      // Fallback: construct a basic capabilities object
      return this.buildFallback(overriddenGeminiModel);
    }

    // 2. Direct registry match
    const registered = MODEL_REGISTRY[requestedModel];
    if (registered) return registered;

    // 3. Claude model prefix detection — any `claude-*` name gets mapped
    //    to the default Gemini model to prevent 404 errors
    if (requestedModel.startsWith("claude-")) {
      return this.buildFallback(DEFAULT_GEMINI_MODEL);
    }

    // 4. Fallback – treat as literal Gemini model name
    return this.buildFallback(requestedModel);
  }

  /**
   * Returns the list of all known model aliases.
   */
  listModels(): string[] {
    // Only return Gemini model names, not Claude aliases
    return Object.keys(MODEL_REGISTRY).filter((k) => k.startsWith("gemini-"));
  }

  /**
   * Builds a conservative fallback for an unknown model name.
   */
  private buildFallback(geminiModel: string): ModelCapabilities {
    const isGemini3 =
      geminiModel.includes("gemini-3") ||
      geminiModel.includes("gemini-3.");

    return {
      geminiModel,
      supportsThinking: true,
      isGemini3,
      defaultThinkingLevel: isGemini3 ? "HIGH" : undefined,
      maxOutputTokens: 65_536,
    };
  }
}
