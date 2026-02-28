import { spawn } from "node:child_process";
import type { ServerOptions } from "../server/server.js";

/**
 * Console coloring helper
 */
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  dim: "\x1b[2m",
};

/**
 * Spawns the Duck Talk voice interface (via npx duck-talk) with the required
 * environment variables configured so that it routes Claude Code requests
 * through this proxy.
 *
 * @param serverOptions Options used to start the proxy server
 */
export async function startDuckTalk(
  serverOptions: ServerOptions
): Promise<void> {
  const { port, host, apiKey } = serverOptions;
  const proxyUrl = `http://${host}:${port}`;

  console.log(`\n${C.green}●${C.reset} Starting Duck Talk Voice Interface...`);
  console.log(
    `  ${C.dim}Routing Claude Code through proxy at ${proxyUrl}${C.reset}\n`
  );

  // Extend current environment with proxy config
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: proxyUrl,
    ANTHROPIC_API_KEY: "dummy",
    // We pass the Gemini API key through so Duck Talk can use it for STT/TTS
    GEMINI_API_KEY: apiKey,
  };

  try {
    const child = spawn("npx", ["--yes", "duck_talk"], {
      stdio: "inherit",
      env,
      shell: true,
    });

    child.on("error", (err) => {
      console.error(
        `${C.red}${C.bold}Failed to start Duck Talk:${C.reset}`,
        err
      );
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        console.error(
          `\n${C.yellow}Duck Talk exited with code ${code}${C.reset}`
        );
      }
      // Provide a clean exit
      process.exit(code ?? 0);
    });

    // We catch signals so the child process gets a chance to clean up
    process.on("SIGINT", () => {
      child.kill("SIGINT");
    });
    process.on("SIGTERM", () => {
      child.kill("SIGTERM");
    });
  } catch (err) {
    console.error(
      `${C.red}${C.bold}Could not launch Duck Talk:${C.reset}`,
      err
    );
  }
}
