# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- **Start proxy**: `bun run start` (Requires `GEMINI_API_KEY` env var or `--api-key` flag)
- **Watch mode**: `bun run dev`
- **Type check**: `bun run typecheck` (uses `tsc --noEmit`)

### Testing
- **Run all tests**: `bun test`
- **Run specific test file**: `bun test tests/converters/request-converter.test.ts`
- **Run with filter**: `bun test -t "thinking"`

## High-Level Architecture

The project is a high-performance Bun.js proxy that translates Anthropic Messages API requests into Google Gemini API calls.

### Core Pipeline (`src/server/router.ts`)
The `Router` orchestrates the conversion lifecycle for each incoming `/v1/messages` request:
1. **Model Resolution**: Maps Anthropic model names (e.g., `claude-3-5-sonnet`) to Gemini equivalents using `ModelConfigService`.
2. **Request Conversion**: Transforms the Anthropic payload into Gemini's `generateContent` format via `RequestConverter`.
3. **Execution**: Calls the Gemini API using `GeminiClient`.
4. **Response Conversion**: Transforms Gemini's response (unary or SSE stream) back into Anthropic's format using `ResponseConverter` or `StreamConverter`.

### Thought Signatures (`src/services/thought-signature.ts`)
Gemini 3 models require **thought signatures** for multi-turn tool use. The proxy manages these transparently:
- **Extraction**: Signatures are captured from Gemini responses and stored in a request-scoped service.
- **Injection**: When replaying conversation history, signatures are re-attached to the corresponding assistant tool-use blocks.
- **Fallback**: Injects a dummy signature (`skip_thought_signature_validator`) when original signatures are missing (e.g., history from a different model).

### Code Structure
- `/src/converters`: Pure logic for transforming request/response payloads.
- `/src/models`: Shared TypeScript interfaces for both APIs and model capabilities.
- `/src/server`: HTTP server (`Bun.serve`) and request routing.
- `/src/services`: External API clients and stateful logic like signature management.
- `/src/utils`: Logging and error handling.
