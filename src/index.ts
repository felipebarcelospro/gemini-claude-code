#!/usr/bin/env bun
/**
 * CLI entry point for the Gemini-to-Anthropic proxy server.
 *
 * Parses command-line arguments, validates configuration, and starts
 * the HTTP proxy server.
 *
 * Usage:
 *   bun run src/index.ts --api-key <KEY> [--port <PORT>] [--host <HOST>]
 *
 * Environment variables:
 *   GEMINI_API_KEY   - Google AI API key (alternative to --api-key)
 *   PORT             - Server port (default: 4100)
 *   HOST             - Server host (default: 127.0.0.1)
 */

import { ProxyServer, type ServerOptions } from "./server/server";
import { ServiceInstaller, type ServiceConfig } from "./commands/service";
import { Logger, LogLevel } from "./utils/logger";

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
} as const;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  apiKey: string;
  port: number;
  host: string;
  verbose: boolean;
  model?: string;
  help: boolean;
  /** Subcommand: "service" */
  subcommand?: string;
  /** Sub-action: "install" | "uninstall" | "status" */
  subaction?: string;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    port: parseInt(process.env.PORT ?? "4100", 10),
    host: process.env.HOST ?? "127.0.0.1",
    verbose: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "service":
        result.subcommand = "service";
        result.subaction = args[++i]; // install | uninstall | status
        break;
      case "live":
        result.subcommand = "live";
        break;
      case "--api-key":
      case "-k":
        result.apiKey = args[++i] ?? "";
        break;
      case "--port":
      case "-p":
        result.port = parseInt(args[++i] ?? "4100", 10);
        break;
      case "--host":
      case "-H":
        result.host = args[++i] ?? "127.0.0.1";
        break;
      case "--model":
      case "-m":
        result.model = args[++i];
        break;
      case "--verbose":
      case "-v":
        result.verbose = true;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${C.bold}${C.cyan}gemini-claude-code${C.reset} — Gemini-to-Anthropic API proxy for Claude Code

${C.bold}USAGE${C.reset}
  ${C.dim}$${C.reset} bun run src/index.ts ${C.yellow}--api-key${C.reset} <GEMINI_API_KEY> [options]
  ${C.dim}$${C.reset} GEMINI_API_KEY=<key> bun run src/index.ts [options]

${C.bold}OPTIONS${C.reset}
  ${C.yellow}--api-key, -k${C.reset}   ${C.dim}<string>${C.reset}  Google AI API key ${C.dim}(or GEMINI_API_KEY env var)${C.reset}
  ${C.yellow}--port, -p${C.reset}      ${C.dim}<number>${C.reset}  Server port ${C.dim}(default: 4100)${C.reset}
  ${C.yellow}--host, -H${C.reset}      ${C.dim}<string>${C.reset}  Server host ${C.dim}(default: 127.0.0.1)${C.reset}
  ${C.yellow}--model, -m${C.reset}     ${C.dim}<string>${C.reset}  Default Gemini model override
  ${C.yellow}--verbose, -v${C.reset}             Enable debug logging
  ${C.yellow}--help, -h${C.reset}                Show this help message

${C.bold}COMMANDS${C.reset}
  ${C.green}live${C.reset}              Launch Gemini Live voice conversation interface with Claude Code
  ${C.green}service install${C.reset}     Register as auto-start service (macOS/Linux/Windows)
  ${C.green}service uninstall${C.reset}   Remove auto-start service
  ${C.green}service status${C.reset}     Check if service is running

${C.bold}SUPPORTED MODELS${C.reset}
  ${C.green}gemini-3.1-pro${C.reset}           → gemini-3.1-pro-preview
  ${C.green}gemini-3.0-flash${C.reset}         → gemini-3-flash-preview
  ${C.green}gemini-2.5-pro${C.reset}           → gemini-2.5-pro-preview-06-05
  ${C.green}gemini-2.5-flash${C.reset}         → gemini-2.5-flash-preview-05-20
  ${C.green}gemini-2.0-flash${C.reset}         → gemini-2.0-flash
  ${C.dim}claude-*${C.reset}                 → auto-mapped to gemini-3-flash-preview

${C.bold}CLAUDE CODE CONFIGURATION${C.reset}
  Set these environment variables before running Claude Code:
  ${C.dim}$${C.reset} export ANTHROPIC_BASE_URL=http://localhost:4100
  ${C.dim}$${C.reset} export ANTHROPIC_API_KEY=dummy
  ${C.dim}$${C.reset} export ANTHROPIC_MODEL=gemini-3.0-flash

${C.bold}EXAMPLES${C.reset}
  ${C.dim}# Start the proxy server${C.reset}
  ${C.dim}$${C.reset} bun run src/index.ts --api-key AIza...

  ${C.dim}# Start with custom port and verbose logging${C.reset}
  ${C.dim}$${C.reset} GEMINI_API_KEY=AIza... bun run src/index.ts -p 8080 -v

  ${C.dim}# Install as auto-start service${C.reset}
  ${C.dim}$${C.reset} bun run src/index.ts service install --api-key AIza... -p 4100

  ${C.dim}# Check service status${C.reset}
  ${C.dim}$${C.reset} bun run src/index.ts service status

  ${C.dim}# Remove auto-start service${C.reset}
  ${C.dim}$${C.reset} bun run src/index.ts service uninstall
`);
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function printBanner(options: ServerOptions): void {
  console.log(`
${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗
║           ${C.reset}${C.bold} gemini-claude-code ${C.cyan}                               ║
║           ${C.reset}${C.dim}  Gemini ↔ Anthropic API Proxy  ${C.cyan}                    ║
╚══════════════════════════════════════════════════════════════╝${C.reset}

  ${C.green}●${C.reset} Server running at ${C.bold}http://${options.host}:${options.port}${C.reset}
  ${C.green}●${C.reset} Proxying to Google Gemini API

  ${C.bold}Configure Claude Code:${C.reset}
  ${C.dim}export${C.reset} ANTHROPIC_BASE_URL=${C.cyan}http://${options.host}:${options.port}${C.reset}
  ${C.dim}export${C.reset} ANTHROPIC_API_KEY=${C.cyan}dummy${C.reset}
  ${C.dim}export${C.reset} ANTHROPIC_MODEL=${C.cyan}gemini-3.0-flash${C.reset}

  ${C.dim}Press Ctrl+C to stop${C.reset}
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cliArgs = parseArgs(process.argv.slice(2));

  if (cliArgs.help) {
    printHelp();
    process.exit(0);
  }

  // Configure logger
  const logger = Logger.getInstance();
  if (cliArgs.verbose) {
    logger.setLevel(LogLevel.DEBUG);
  }

  // ── Handle 'service' subcommand ─────────────────────────────────────
  if (cliArgs.subcommand === "service") {
    if (!cliArgs.apiKey && cliArgs.subaction === "install") {
      console.error(
        `${C.red}${C.bold}Error:${C.reset} Gemini API key is required for service install.`
      );
      console.error(
        `  Use ${C.yellow}--api-key${C.reset} flag or set ${C.yellow}GEMINI_API_KEY${C.reset} environment variable.\n`
      );
      process.exit(1);
    }

    const serviceConfig: ServiceConfig = {
      apiKey: cliArgs.apiKey,
      port: cliArgs.port,
      host: cliArgs.host,
      model: cliArgs.model,
      verbose: cliArgs.verbose,
      projectDir: process.cwd(),
    };

    const installer = new ServiceInstaller(serviceConfig);

    switch (cliArgs.subaction) {
      case "install":
        installer.install();
        break;
      case "uninstall":
        installer.uninstall();
        break;
      case "status":
        installer.status();
        break;
      default:
        console.error(
          `${C.red}${C.bold}Error:${C.reset} Unknown service action: ${cliArgs.subaction}`
        );
        console.error(
          `  Available actions: ${C.green}install${C.reset}, ${C.green}uninstall${C.reset}, ${C.green}status${C.reset}\n`
        );
        process.exit(1);
    }
    return;
  }

  // Validate API key
  if (!cliArgs.apiKey) {
    console.error(
      `${C.red}${C.bold}Error:${C.reset} Gemini API key is required.`
    );
    console.error(
      `  Use ${C.yellow}--api-key${C.reset} flag or set ${C.yellow}GEMINI_API_KEY${C.reset} environment variable.\n`
    );
    printHelp();
    process.exit(1);
  }

  // Build model overrides
  const modelOverrides: Record<string, string> = {};
  if (cliArgs.model) {
    // When a default model is provided, map common Claude model names to it
    const claudeModels = [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250414",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-sonnet-4-6",
      "claude-opus-4-6",
    ];
    for (const name of claudeModels) {
      modelOverrides[name] = cliArgs.model;
    }
  }

  // Create and start server
  const serverOptions: ServerOptions = {
    port: cliArgs.port,
    host: cliArgs.host,
    apiKey: cliArgs.apiKey,
    modelOverrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined,
  };

  const server = new ProxyServer(serverOptions);

  try {
    server.start();
    printBanner(serverOptions);

    if (cliArgs.subcommand === "live") {
      // Dynamic import to avoid loading child_process immediately
      import("./commands/live.js").then(({ startDuckTalk }) => {
        startDuckTalk(serverOptions);
      });
    }
  } catch (error) {
    console.error(`${C.red}${C.bold}Failed to start server:${C.reset}`, error);
    process.exit(1);
  }

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log(`\n${C.dim}Shutting down...${C.reset}`);
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
