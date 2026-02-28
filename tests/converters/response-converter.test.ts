/**
 * Tests for the Gemini → Anthropic response converter.
 */

import { describe, test, expect } from "bun:test";
import { ResponseConverter } from "../../src/converters/response-converter";
import { ThoughtSignatureService } from "../../src/services/thought-signature";
import type { GeminiGenerateContentResponse } from "../../src/models/gemini";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createConverter(): ResponseConverter {
  return new ResponseConverter(new ThoughtSignatureService(), "test-model");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ResponseConverter", () => {
  test("converts simple text response", () => {
    const converter = createConverter();
    const geminiResponse: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Hello there!" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const result = converter.convert(geminiResponse);

    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as any).text).toBe("Hello there!");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.model).toBe("test-model");
  });

  test("converts function call response", () => {
    const converter = createConverter();
    const geminiResponse: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "get_weather",
                  args: { location: "NYC" },
                },
                thoughtSignature: "sig123",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = converter.convert(geminiResponse);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("tool_use");

    const toolUse = result.content[0] as any;
    expect(toolUse.name).toBe("get_weather");
    expect(toolUse.input).toEqual({ location: "NYC" });
    expect(toolUse.id).toMatch(/^toolu_/);
    expect(result.stop_reason).toBe("tool_use");
  });

  test("converts thinking response", () => {
    const converter = createConverter();
    const geminiResponse: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                text: "Let me think about this...",
                thought: true,
                thoughtSignature: "thinking_sig",
              },
              {
                text: "The answer is 42.",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = converter.convert(geminiResponse);

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("thinking");
    expect((result.content[0] as any).thinking).toBe(
      "Let me think about this..."
    );
    expect((result.content[0] as any).signature).toBe("thinking_sig");

    expect(result.content[1].type).toBe("text");
    expect((result.content[1] as any).text).toBe("The answer is 42.");
  });

  test("maps STOP to end_turn", () => {
    const converter = createConverter();
    const result = converter.convert({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "done" }] },
          finishReason: "STOP",
        },
      ],
    });

    expect(result.stop_reason).toBe("end_turn");
  });

  test("maps MAX_TOKENS to max_tokens", () => {
    const converter = createConverter();
    const result = converter.convert({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "truncated..." }] },
          finishReason: "MAX_TOKENS",
        },
      ],
    });

    expect(result.stop_reason).toBe("max_tokens");
  });

  test("overrides stop_reason to tool_use when tool_use blocks present", () => {
    const converter = createConverter();
    const result = converter.convert({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: { name: "test_tool", args: {} },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });

    expect(result.stop_reason).toBe("tool_use");
  });

  test("converts usage metadata", () => {
    const converter = createConverter();
    const result = converter.convert({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "ok" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
        thoughtsTokenCount: 20,
      },
    });

    expect(result.usage.input_tokens).toBe(100);
    // output = candidatesTokenCount + thoughtsTokenCount
    expect(result.usage.output_tokens).toBe(70);
  });

  test("handles empty candidates", () => {
    const converter = createConverter();
    const result = converter.convert({
      candidates: [],
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.stop_reason).toBe("end_turn");
  });

  test("handles undefined candidates", () => {
    const converter = createConverter();
    const result = converter.convert({});

    expect(result.content).toHaveLength(1);
    expect(result.stop_reason).toBe("end_turn");
  });

  test("skips empty text parts that are signature carriers", () => {
    const converter = createConverter();
    const result = converter.convert({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "Real content" },
              { text: "", thoughtSignature: "some_sig" } as any,
            ],
          },
          finishReason: "STOP",
        },
      ],
    });

    // Should only have one text block (the empty one is skipped)
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as any).text).toBe("Real content");
  });

  test("handles multiple function calls (parallel)", () => {
    const converter = createConverter();
    const result = converter.convert({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: { name: "tool_a", args: { x: 1 } },
                thoughtSignature: "sig_a",
              },
              {
                functionCall: { name: "tool_b", args: { y: 2 } },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("tool_use");
    expect(result.content[1].type).toBe("tool_use");
    expect((result.content[0] as any).name).toBe("tool_a");
    expect((result.content[1] as any).name).toBe("tool_b");
    expect(result.stop_reason).toBe("tool_use");
  });

  test("generates unique message IDs", () => {
    const converter = createConverter();
    const r1 = converter.convert({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "a" }] },
          finishReason: "STOP",
        },
      ],
    });

    const converter2 = createConverter();
    const r2 = converter2.convert({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "b" }] },
          finishReason: "STOP",
        },
      ],
    });

    expect(r1.id).toMatch(/^msg_/);
    expect(r2.id).toMatch(/^msg_/);
    expect(r1.id).not.toBe(r2.id);
  });
});
