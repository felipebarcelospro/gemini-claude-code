/**
 * Tests for the ThoughtSignatureService.
 */

import { describe, test, expect } from "bun:test";
import {
  ThoughtSignatureService,
  DUMMY_THOUGHT_SIGNATURE,
} from "../../src/services/thought-signature";
import type { GeminiContent } from "../../src/models/gemini";

describe("ThoughtSignatureService", () => {
  test("stores and retrieves signatures", () => {
    const service = new ThoughtSignatureService();

    service.store_signature(0, 0, "sig_abc");
    service.store_signature(1, 2, "sig_xyz");

    expect(service.getSignature(0, 0)).toBe("sig_abc");
    expect(service.getSignature(1, 2)).toBe("sig_xyz");
    expect(service.getSignature(0, 1)).toBeUndefined();
  });

  test("stores and retrieves text signatures", () => {
    const service = new ThoughtSignatureService();

    service.storeTextSignature("text_sig_1");
    expect(service.getLastTextSignature()).toBe("text_sig_1");

    service.storeTextSignature("text_sig_2");
    expect(service.getLastTextSignature()).toBe("text_sig_2");
  });

  test("clear() removes all stored data", () => {
    const service = new ThoughtSignatureService();

    service.store_signature(0, 0, "sig_a");
    service.storeTextSignature("text_sig");

    service.clear();

    expect(service.getSignature(0, 0)).toBeUndefined();
    expect(service.getLastTextSignature()).toBeNull();
  });

  test("extractFromContents - extracts signatures from model turns", () => {
    const service = new ThoughtSignatureService();

    const contents: GeminiContent[] = [
      {
        role: "user",
        parts: [{ text: "Hello" }],
      },
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "tool_a", args: {} },
            thoughtSignature: "model_sig_1",
          } as any,
          {
            text: "Some text",
            thoughtSignature: "model_sig_2",
          } as any,
        ],
      },
    ];

    service.extractFromContents(contents);

    expect(service.getSignature(1, 0)).toBe("model_sig_1");
    expect(service.getSignature(1, 1)).toBe("model_sig_2");
    // Text signature should be the last one seen
    expect(service.getLastTextSignature()).toBe("model_sig_2");
  });

  test("extractFromContents - skips user turns", () => {
    const service = new ThoughtSignatureService();

    const contents: GeminiContent[] = [
      {
        role: "user",
        parts: [
          { text: "Hello", thoughtSignature: "user_sig" } as any,
        ],
      },
    ];

    service.extractFromContents(contents);

    expect(service.getSignature(0, 0)).toBeUndefined();
  });

  test("ensureSignatures - adds dummy to first FC without signature", () => {
    const service = new ThoughtSignatureService();

    const contents: GeminiContent[] = [
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "tool_a", args: {} },
          },
        ],
      },
    ];

    service.ensureSignatures(contents, true);

    const part = contents[0].parts[0] as any;
    expect(part.thoughtSignature).toBe(DUMMY_THOUGHT_SIGNATURE);
  });

  test("ensureSignatures - preserves existing signature", () => {
    const service = new ThoughtSignatureService();

    const contents: GeminiContent[] = [
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "tool_a", args: {} },
            thoughtSignature: "existing_sig",
          } as any,
        ],
      },
    ];

    service.ensureSignatures(contents, true);

    const part = contents[0].parts[0] as any;
    expect(part.thoughtSignature).toBe("existing_sig");
  });

  test("ensureSignatures - uses stored signature when available", () => {
    const service = new ThoughtSignatureService();
    service.store_signature(0, 0, "stored_sig");

    const contents: GeminiContent[] = [
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "tool_a", args: {} },
          },
        ],
      },
    ];

    service.ensureSignatures(contents, true);

    const part = contents[0].parts[0] as any;
    expect(part.thoughtSignature).toBe("stored_sig");
  });

  test("ensureSignatures - only first FC gets signature in parallel", () => {
    const service = new ThoughtSignatureService();

    const contents: GeminiContent[] = [
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "tool_a", args: {} },
          },
          {
            functionCall: { name: "tool_b", args: {} },
          },
        ],
      },
    ];

    service.ensureSignatures(contents, true);

    const partA = contents[0].parts[0] as any;
    const partB = contents[0].parts[1] as any;
    expect(partA.thoughtSignature).toBe(DUMMY_THOUGHT_SIGNATURE);
    expect(partB.thoughtSignature).toBeUndefined();
  });

  test("ensureSignatures - skips non-Gemini3 models", () => {
    const service = new ThoughtSignatureService();

    const contents: GeminiContent[] = [
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "tool_a", args: {} },
          },
        ],
      },
    ];

    service.ensureSignatures(contents, false);

    const part = contents[0].parts[0] as any;
    expect(part.thoughtSignature).toBeUndefined();
  });

  test("ensureSignatures - handles multiple sequential steps", () => {
    const service = new ThoughtSignatureService();

    const contents: GeminiContent[] = [
      {
        role: "user",
        parts: [{ text: "Do something" }],
      },
      {
        role: "model",
        parts: [
          { functionCall: { name: "step1", args: {} } },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "step1", response: { ok: true } } },
        ],
      },
      {
        role: "model",
        parts: [
          { functionCall: { name: "step2", args: {} } },
        ],
      },
    ];

    service.ensureSignatures(contents, true);

    // Both model turns should have signatures on their FCs
    const step1Part = contents[1].parts[0] as any;
    const step2Part = contents[3].parts[0] as any;
    expect(step1Part.thoughtSignature).toBe(DUMMY_THOUGHT_SIGNATURE);
    expect(step2Part.thoughtSignature).toBe(DUMMY_THOUGHT_SIGNATURE);
  });

  test("DUMMY_THOUGHT_SIGNATURE has correct value", () => {
    expect(DUMMY_THOUGHT_SIGNATURE).toBe("skip_thought_signature_validator");
  });
});
