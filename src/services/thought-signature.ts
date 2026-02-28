/**
 * Thought Signature Management Service.
 *
 * Gemini 3 models produce `thoughtSignature` fields within response parts
 * (especially on `functionCall` parts). These must be preserved and echoed
 * back exactly as received in subsequent requests within the same turn.
 *
 * This service is responsible for:
 * - Extracting thought signatures from Gemini responses.
 * - Injecting thought signatures into Gemini requests when replaying
 *   assistant messages from the Anthropic conversation history.
 * - Providing a dummy signature for history transfer scenarios.
 *
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 */

import type { GeminiPart, GeminiContent } from "../models/gemini";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Dummy signature value that tells the Gemini API to skip validation.
 * Used when transferring history from non-Gemini models or when
 * injecting synthetic function call blocks.
 */
export const DUMMY_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

// ---------------------------------------------------------------------------
// ThoughtSignatureService
// ---------------------------------------------------------------------------

/**
 * Manages thought signatures for Gemini 3 model interactions.
 *
 * Since the Anthropic API has no concept of thought signatures, we need
 * to handle them transparently:
 *
 * 1. When converting Gemini → Anthropic responses, we strip the signatures
 *    but store them keyed by a deterministic identifier.
 * 2. When converting Anthropic → Gemini requests (replaying history), we
 *    re-attach the stored signatures to the correct parts.
 * 3. If no stored signature is available (e.g. history from a different
 *    model), we inject the dummy signature.
 */
export class ThoughtSignatureService {
  /**
   * Stores signatures keyed by `{turnIndex}:{partIndex}` for the
   * lifetime of the current request context.
   */
  private readonly store = new Map<string, string>();

  /**
   * Stores the latest signature returned by the model for non-FC parts
   * (text responses)—this helps to maintain reasoning quality.
   */
  private lastTextSignature: string | null = null;

  /**
   * Records a thought signature extracted from a Gemini response part.
   *
   * @param turnIndex - Index of the content turn in the history.
   * @param partIndex - Index of the part within the turn.
   * @param signature - The raw signature string.
   */
  store_signature(turnIndex: number, partIndex: number, signature: string): void {
    this.store.set(`${turnIndex}:${partIndex}`, signature);
  }

  /**
   * Records the last text-part signature for optional re-injection.
   */
  storeTextSignature(signature: string): void {
    this.lastTextSignature = signature;
  }

  /**
   * Retrieves a previously stored signature.
   */
  getSignature(turnIndex: number, partIndex: number): string | undefined {
    return this.store.get(`${turnIndex}:${partIndex}`);
  }

  /**
   * Returns the last captured text-part signature, if any.
   */
  getLastTextSignature(): string | null {
    return this.lastTextSignature;
  }

  /**
   * Extracts and stores all thought signatures from an array of Gemini
   * content turns (typically the full conversation history from a response).
   *
   * @param contents - The Gemini contents array.
   */
  extractFromContents(contents: GeminiContent[]): void {
    for (let t = 0; t < contents.length; t++) {
      const turn = contents[t];
      if (turn.role !== "model") continue;

      for (let p = 0; p < turn.parts.length; p++) {
        const part = turn.parts[p] as GeminiPart & { thoughtSignature?: string };
        if (part.thoughtSignature) {
          this.store_signature(t, p, part.thoughtSignature);

          // Also track text signatures for quality
          if ("text" in part && !(("functionCall" in part) as boolean)) {
            this.storeTextSignature(part.thoughtSignature);
          }
        }
      }
    }
  }

  /**
   * Ensures that function-call parts in the provided content array carry
   * the correct thought signatures.
   *
   * For Gemini 3 models, this is mandatory:
   * - The first `functionCall` part in each step must have a signature.
   * - Parallel FCs: only the first FC gets the signature.
   *
   * If no stored signature is found, the dummy value is injected.
   *
   * @param contents - The Gemini contents to augment.
   * @param isGemini3 - Whether the target model is a Gemini 3 model.
   * @returns The augmented contents array (mutated in-place for performance).
   */
  ensureSignatures(contents: GeminiContent[], isGemini3: boolean): GeminiContent[] {
    if (!isGemini3) return contents;

    for (let t = 0; t < contents.length; t++) {
      const turn = contents[t];
      if (turn.role !== "model") continue;

      let firstFCFound = false;
      for (let p = 0; p < turn.parts.length; p++) {
        const part = turn.parts[p] as GeminiPart & { thoughtSignature?: string };

        if ("functionCall" in part) {
          if (!firstFCFound) {
            // First FC in this step MUST have a signature
            if (!part.thoughtSignature) {
              const stored = this.getSignature(t, p);
              (part as { thoughtSignature?: string }).thoughtSignature =
                stored ?? DUMMY_THOUGHT_SIGNATURE;
            }
            firstFCFound = true;
          }
          // Subsequent parallel FCs should NOT have signatures
        }
      }
    }

    return contents;
  }

  /**
   * Clears all stored signatures (used between requests).
   */
  clear(): void {
    this.store.clear();
    this.lastTextSignature = null;
  }
}
