/**
 * Tests for the Anthropic → Gemini request converter.
 */

import { describe, test, expect } from "bun:test";
import { RequestConverter } from "../../src/converters/request-converter";
import { ThoughtSignatureService } from "../../src/services/thought-signature";
import type { AnthropicMessagesRequest } from "../../src/models/anthropic";
import type { ModelCapabilities } from "../../src/models/config";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GEMINI_3_CAPS: ModelCapabilities = {
  geminiModel: "gemini-3-flash-preview",
  supportsThinking: true,
  isGemini3: true,
  defaultThinkingLevel: "HIGH",
  maxOutputTokens: 65_536,
};

const GEMINI_25_CAPS: ModelCapabilities = {
  geminiModel: "gemini-2.5-pro-preview-06-05",
  supportsThinking: true,
  isGemini3: false,
  maxOutputTokens: 65_536,
};

function createConverter(): RequestConverter {
  return new RequestConverter(new ThoughtSignatureService());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RequestConverter", () => {
  test("converts simple text message", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].role).toBe("user");
    expect(result.contents[0].parts).toHaveLength(1);
    expect((result.contents[0].parts[0] as any).text).toBe("Hello");
  });

  test("converts text block array", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: "World" },
          ],
        },
      ],
      max_tokens: 1024,
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].parts).toHaveLength(2);
    expect((result.contents[0].parts[0] as any).text).toBe("Hello");
    expect((result.contents[0].parts[1] as any).text).toBe("World");
  });

  test("maps assistant role to model", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
      ],
      max_tokens: 1024,
    };

    const result = converter.convert(request, GEMINI_25_CAPS);

    expect(result.contents[0].role).toBe("user");
    expect(result.contents[1].role).toBe("model");
  });

  test("converts system prompt (string)", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
      system: "You are a helpful assistant.",
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.systemInstruction).toBeDefined();
    expect((result.systemInstruction!.parts[0] as any).text).toBe(
      "You are a helpful assistant."
    );
  });

  test("converts system prompt (array)", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
      system: [
        { type: "text", text: "You are a coder." },
        { type: "text", text: "Be concise." },
      ],
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.systemInstruction!.parts).toHaveLength(2);
  });

  test("converts tools to functionDeclarations", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
      tools: [
        {
          name: "get_weather",
          description: "Gets weather",
          input_schema: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      ],
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].functionDeclarations).toHaveLength(1);
    expect(result.tools![0].functionDeclarations![0].name).toBe("get_weather");
  });

  test("converts tool_choice auto", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
      tool_choice: { type: "auto" },
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.toolConfig?.functionCallingConfig?.mode).toBe("AUTO");
  });

  test("converts tool_choice any", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
      tool_choice: { type: "any" },
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.toolConfig?.functionCallingConfig?.mode).toBe("ANY");
  });

  test("converts tool_choice none", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
      tool_choice: { type: "none" },
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.toolConfig?.functionCallingConfig?.mode).toBe("NONE");
  });

  test("sets thinking config for Gemini 3", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.generationConfig?.thinkingConfig?.thinkingLevel).toBe("HIGH");
    expect(result.generationConfig?.thinkingConfig?.includeThoughts).toBe(true);
  });

  test("maps thinking budget to level for Gemini 3", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
      thinking: { type: "enabled", budget_tokens: 2048 },
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.generationConfig?.thinkingConfig?.thinkingLevel).toBe("LOW");
  });

  test("uses thinkingBudget for Gemini 2.5", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
      thinking: { type: "enabled", budget_tokens: 8192 },
    };

    const result = converter.convert(request, GEMINI_25_CAPS);

    expect(result.generationConfig?.thinkingConfig?.thinkingBudget).toBe(8192);
  });

  test("maps basic generation params", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 4096,
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      stop_sequences: ["END"],
    };

    const result = converter.convert(request, GEMINI_3_CAPS);
    const config = result.generationConfig!;

    expect(config.temperature).toBe(0.7);
    expect(config.topP).toBe(0.9);
    expect(config.topK).toBe(40);
    expect(config.maxOutputTokens).toBe(4096);
    expect(config.stopSequences).toEqual(["END"]);
  });

  test("caps maxOutputTokens to model maximum", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 200_000,
    };

    const caps = { ...GEMINI_3_CAPS, maxOutputTokens: 8192 };
    const result = converter.convert(request, caps);

    expect(result.generationConfig?.maxOutputTokens).toBe(8192);
  });

  test("disables safety settings", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    };

    const result = converter.convert(request, GEMINI_3_CAPS);

    expect(result.safetySettings).toHaveLength(4);
    for (const setting of result.safetySettings!) {
      expect(setting.threshold).toBe("BLOCK_NONE");
    }
  });

  test("converts tool_use in assistant message with thought signature", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [
        { role: "user", content: "Check weather" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_123",
              name: "get_weather",
              input: { location: "NYC" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "72°F sunny",
            },
          ],
        },
      ],
      max_tokens: 1024,
    };

    converter.buildToolNameMap(request.messages);
    const result = converter.convert(request, GEMINI_3_CAPS);

    // The assistant message should be converted to model role
    const modelContent = result.contents.find((c) => c.role === "model");
    expect(modelContent).toBeDefined();

    // Should have a functionCall part
    const fcPart = modelContent!.parts.find(
      (p) => "functionCall" in p
    ) as any;
    expect(fcPart).toBeDefined();
    expect(fcPart.functionCall.name).toBe("get_weather");
    // Should have thought signature for Gemini 3
    expect(fcPart.thoughtSignature).toBeDefined();
  });

  test("converts tool_result to functionResponse", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [
        { role: "user", content: "Do something" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "my_tool",
              input: { x: 1 },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "Done!",
            },
          ],
        },
      ],
      max_tokens: 1024,
    };

    converter.buildToolNameMap(request.messages);
    const result = converter.convert(request, GEMINI_25_CAPS);

    // Find the functionResponse content
    const frContent = result.contents.find(
      (c) => c.parts.some((p) => "functionResponse" in p)
    );
    expect(frContent).toBeDefined();
    expect(frContent!.role).toBe("user");

    const frPart = frContent!.parts[0] as any;
    expect(frPart.functionResponse.name).toBe("my_tool");
    expect(frPart.functionResponse.response.result).toBe("Done!");
  });

  test("converts error tool_result", () => {
    const converter = createConverter();
    const request: AnthropicMessagesRequest = {
      model: "test",
      messages: [
        { role: "user", content: "Do something" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_err",
              name: "failing_tool",
              input: {},
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_err",
              content: "Tool failed!",
              is_error: true,
            },
          ],
        },
      ],
      max_tokens: 1024,
    };

    converter.buildToolNameMap(request.messages);
    const result = converter.convert(request, GEMINI_25_CAPS);

    const frContent = result.contents.find(
      (c) => c.parts.some((p) => "functionResponse" in p)
    );
    const frPart = frContent!.parts[0] as any;
    expect(frPart.functionResponse.response.error).toBe("Tool failed!");
  });
});
