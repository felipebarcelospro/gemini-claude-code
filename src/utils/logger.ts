/**
 * Logging utility with configurable verbosity levels.
 *
 * Provides structured, colour-coded console output with timestamps.
 * Designed to be lightweight and dependency-free.
 */

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

// ---------------------------------------------------------------------------
// ANSI colours for terminal output
// ---------------------------------------------------------------------------

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
} as const;

// ---------------------------------------------------------------------------
// Logger class
// ---------------------------------------------------------------------------

/**
 * Simple structured logger with colour support and configurable levels.
 *
 * @example
 * ```ts
 * const log = Logger.getInstance();
 * log.info("Server started", { port: 3000 });
 * log.debug("Request body", body);
 * ```
 */
export class Logger {
  private static instance: Logger;
  private level: LogLevel;

  private constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  /** Returns the singleton logger instance. */
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** Sets the global log level. */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** Logs a debug-level message. */
  debug(message: string, ...data: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      this.write("DEBUG", COLORS.dim, message, data);
    }
  }

  /** Logs an info-level message. */
  info(message: string, ...data: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      this.write("INFO", COLORS.cyan, message, data);
    }
  }

  /** Logs a warning-level message. */
  warn(message: string, ...data: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      this.write("WARN", COLORS.yellow, message, data);
    }
  }

  /** Logs an error-level message. */
  error(message: string, ...data: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      this.write("ERROR", COLORS.red, message, data);
    }
  }

  /** Internal write method. */
  private write(
    level: string,
    color: string,
    message: string,
    data: unknown[]
  ): void {
    const timestamp = new Date().toISOString();
    const prefix = `${COLORS.dim}${timestamp}${COLORS.reset} ${color}[${level}]${COLORS.reset}`;

    if (data.length > 0) {
      console.log(prefix, message, ...data);
    } else {
      console.log(prefix, message);
    }
  }
}
