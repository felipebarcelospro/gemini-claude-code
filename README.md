# gemini-claude-code

[![npm version](https://img.shields.io/npm/v/gemini-claude-code.svg)](https://www.npmjs.com/package/gemini-claude-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Use Gemini 3.x models with Claude Code** — Drop-in proxy that lets you use Google's latest Gemini models (3.1 Pro, 3.0 Flash, 2.5 Pro) with Claude Code and any Anthropic-compatible tool.

---

## Why?

Claude Code is an incredible coding agent, but it's locked to Anthropic's API. This proxy unlocks it for **Google Gemini models**, giving you:

- 🚀 **Gemini 3.1 Pro** — Google's most capable model for complex reasoning and coding
- ⚡ **Gemini 3.0 Flash** — Frontier performance at a fraction of the cost
- 🌐 **Google Search Grounding** — Real-time web search powered by Google
- 📄 **URL Context** — Fetch and analyze any URL natively
- 🎥 **YouTube Understanding** — Analyze YouTube videos directly
- 🧠 **Extended Thinking** — Full support for Gemini's reasoning capabilities
- 🔧 **100% Tool Compatibility** — All Claude Code tools work out of the box

---

## 🚀 Quick Start

### Option 1: Run instantly with npx (recommended)

```bash
npx gemini-claude-code --api-key YOUR_GEMINI_API_KEY
```

### Option 2: Install globally

```bash
# Install globally
bun add -g gemini-claude-code

# Run from anywhere
gemini-claude-code --api-key YOUR_GEMINI_API_KEY
```

### Option 3: Clone and run from source

```bash
git clone https://github.com/felipebarcelospro/gemini-claude-code.git
cd gemini-claude-code
bun install
bun run start -- --api-key YOUR_GEMINI_API_KEY
```

### Configure Claude Code

After starting the proxy, configure Claude Code to use it:

```bash
# Set environment variables
export ANTHROPIC_BASE_URL=http://localhost:8082
export ANTHROPIC_API_KEY=dummy
export ANTHROPIC_MODEL=gemini-3.0-flash

# Run Claude Code normally
claude
```

> **Tip:** Add these exports to your `~/.zshrc` or `~/.bashrc` to make them persistent.

---

## 🎯 Model Configuration

### Basic: Single model for everything

```bash
# Use Gemini 3.0 Flash (fast, cost-effective)
export ANTHROPIC_MODEL=gemini-3.0-flash

# Or use Gemini 3.1 Pro (most capable)
export ANTHROPIC_MODEL=gemini-3.1-pro
```

### Advanced: Different models per tier

Claude Code uses different model tiers for different tasks. You can map each tier to a different Gemini model using the native Anthropic environment variables:

```bash
# Main model (used for primary interactions)
export ANTHROPIC_MODEL=gemini-3.0-flash

# Model for "haiku" tier (fast tasks, sub-agents, background)
export ANTHROPIC_DEFAULT_HAIKU_MODEL=gemini-3.0-flash

# Model for "sonnet" tier (balanced, default coding tasks)
export ANTHROPIC_DEFAULT_SONNET_MODEL=gemini-3.0-flash

# Model for "opus" tier (complex reasoning, planning)
export ANTHROPIC_DEFAULT_OPUS_MODEL=gemini-3.1-pro
```

> When you switch models in Claude Code with `/model`, the proxy automatically resolves the model name to the correct Gemini equivalent.

### Supported Models

| Alias | Gemini Model | Context | Max Output | Thinking |
|-------|-------------|---------|------------|----------|
| `gemini-3.1-pro` | `gemini-3.1-pro-preview` | 1M tokens | 65,536 | ✅ Levels |
| `gemini-3.0-flash` | `gemini-3-flash-preview` | 200K tokens | 65,536 | ✅ Levels |
| `gemini-2.5-pro` | `gemini-2.5-pro` | 1M tokens | 65,536 | ✅ Budget |
| `gemini-2.5-flash` | `gemini-2.5-flash` | 1M tokens | 65,536 | ✅ Budget |
| `gemini-2.0-flash` | `gemini-2.0-flash` | 1M tokens | 8,192 | ❌ |

> Any `claude-*` model name is automatically mapped to `gemini-3-flash-preview`, so sub-agents and Teams work seamlessly.

---

## 🌐 Web Tools Integration

The proxy intercepts Claude Code's built-in web tools and supercharges them with Gemini's native capabilities:

| Claude Code Tool | Gemini Integration | What it does |
|-----------------|-------------------|--------------|
| **WebSearch** | Google Search Grounding | Real-time web search powered by Google |
| **WebFetch** | URL Context | Fetch and analyze any URL |
| **WebFetch** (YouTube) | Video Understanding | Analyze YouTube videos using Gemini's multimodal capabilities |

These work automatically — no configuration needed.

---

## 🔧 CLI Reference

```
gemini-claude-code — Gemini-to-Anthropic API proxy for Claude Code

USAGE
  $ npx gemini-claude-code --api-key <GEMINI_API_KEY> [options]
  $ GEMINI_API_KEY=<key> npx gemini-claude-code [options]

OPTIONS
  --api-key, -k   <string>  Google AI API key (or GEMINI_API_KEY env var)
  --port, -p      <number>  Server port (default: 8082)
  --host, -H      <string>  Server host (default: 127.0.0.1)
  --model, -m     <string>  Default Gemini model override
  --verbose, -v             Enable debug logging
  --help, -h                Show help

COMMANDS
  live                Launch Gemini Live voice conversation interface with Claude Code
  service install     Register as auto-start service (macOS/Linux/Windows)
  service uninstall   Remove auto-start service
  service status      Check if service is running
```

### Examples

```bash
# Start with default settings
npx gemini-claude-code --api-key AIza...

# Custom port with verbose logging
npx gemini-claude-code -k AIza... -p 8080 -v

# Override all requests to use Gemini 3.1 Pro
npx gemini-claude-code -k AIza... -m gemini-3.1-pro

# Using environment variable
GEMINI_API_KEY=AIza... npx gemini-claude-code
```

---

## 🔄 Auto-Start on Boot

Register the proxy as a system service so it starts automatically:

```bash
# Install (macOS: launchd, Linux: systemd, Windows: Startup folder)
npx gemini-claude-code service install --api-key AIza... --port 8082

# Check status
npx gemini-claude-code service status

# Remove
npx gemini-claude-code service uninstall
```

| OS | Mechanism | Log Location |
|---|---|---|
| **macOS** | `launchd` | `~/Library/Logs/gemini-claude-code/` |
| **Linux** | `systemd --user` | `journalctl --user -u gemini-claude-code` |
| **Windows** | Startup folder (VBS) | Console output |

---

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────────────────────────────┐     ┌─────────────┐
│ Claude Code  │────▶│   gemini-claude-code (Bun Server)    │────▶│ Gemini API  │
│  (Client)    │◀────│                                      │◀────│   (Google)  │
└─────────────┘     │  ┌──────────┐  ┌──────────────────┐  │     └─────────────┘
                    │  │ Router   │  │ Request Converter │  │
                    │  └──────────┘  └──────────────────┘  │
                    │  ┌──────────┐  ┌──────────────────┐  │
                    │  │ Stream   │  │ Response          │  │
                    │  │Converter │  │ Converter         │  │
                    │  └──────────┘  └──────────────────┘  │
                    │  ┌──────────┐  ┌──────────────────┐  │
                    │  │ Thought  │  │   Web Tools       │  │
                    │  │Signatures│  │   Service         │  │
                    │  └──────────┘  └──────────────────┘  │
                    └──────────────────────────────────────┘
```

### Key Components

| Component | Responsibility |
|-----------|---------------|
| **RequestConverter** | Anthropic Messages → Gemini generateContent |
| **ResponseConverter** | Gemini response → Anthropic Messages response |
| **StreamConverter** | Gemini streaming → Anthropic SSE events |
| **ThoughtSignatureService** | Gemini 3 thought signature lifecycle |
| **WebToolsService** | Google Search, URL Context, YouTube integration |
| **GeminiClient** | HTTP client for Gemini REST API |
| **Router** | Request routing and pipeline orchestration |

---

## � How Thinking Works

The proxy maps Anthropic's thinking configuration to Gemini's equivalent:

| Claude Code Sends | Gemini 3.x | Gemini 2.5 |
|---|---|---|
| `thinking: "enabled"` | `thinkingLevel: "HIGH"` | Dynamic thinking |
| `thinking: "disabled"` | `thinkingLevel: "MINIMAL"` | `thinkingBudget: 0` |
| `budget_tokens: 1024` | `thinkingLevel: "MINIMAL"` | `thinkingBudget: 1024` |
| `budget_tokens: 16384` | `thinkingLevel: "MEDIUM"` | `thinkingBudget: 16384` |
| `budget_tokens: 32768+` | `thinkingLevel: "HIGH"` | `thinkingBudget: 32768` |

---

## 🧪 Testing

```bash
bun test
```

Tests cover:
- ✅ Request conversion (messages, tools, system prompts, thinking config)  
- ✅ Response conversion (text, function calls, thinking blocks, usage)
- ✅ Thought signature management (storage, extraction, injection)
- ✅ Schema sanitization (removes unsupported JSON Schema properties)

---

## 📋 Full API Mapping

### Request Mapping

| Anthropic | Gemini |
|-----------|--------|
| `model` | URL path parameter |
| `messages[].role: "user"` | `contents[].role: "user"` |
| `messages[].role: "assistant"` | `contents[].role: "model"` |
| `system` | `systemInstruction` |
| `max_tokens` | `generationConfig.maxOutputTokens` |
| `temperature` | `generationConfig.temperature` |
| `tools[].input_schema` | `tools[].functionDeclarations[].parameters` |
| `tool_choice.type: "auto"` | `toolConfig.functionCallingConfig.mode: "AUTO"` |
| `thinking.budget_tokens` | `thinkingConfig.thinkingLevel` (Gemini 3) |
| `stream: true` | `streamGenerateContent` endpoint |

### Response Mapping

| Gemini | Anthropic |
|--------|-----------|
| Part with `text` | `{type: "text", text: ...}` |
| Part with `functionCall` | `{type: "tool_use", id: ..., name: ..., input: ...}` |
| Part with `thought: true` | `{type: "thinking", thinking: ..., signature: ...}` |
| `finishReason: "STOP"` | `stop_reason: "end_turn"` |
| `finishReason: "MAX_TOKENS"` | `stop_reason: "max_tokens"` |
| Has `functionCall` parts | `stop_reason: "tool_use"` |

---

## 🔑 Getting a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click **"Create API Key"**
3. Copy the key and use it with `--api-key` or `GEMINI_API_KEY`

> Free tier includes generous usage limits. For production workloads, see [Gemini pricing](https://ai.google.dev/pricing).

---

## 🤝 Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

```bash
# Quick start for contributors
git clone https://github.com/felipebarcelospro/gemini-claude-code.git
cd gemini-claude-code
bun install
bun run dev -- --port 8082
```

---

## 📄 License

MIT © [Felipe Barcelos](https://github.com/felipebarcelospro)
