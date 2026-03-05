import pino from "pino";

const IS_PROD = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (IS_PROD ? "info" : "debug"),
  ...(IS_PROD
    ? {}
    : {
        transport: {
          target: "pino/file",
          options: { destination: 1 }, // stdout
        },
      }),
});

/**
 * Overrides global console.log/warn/error so all existing 703+ console calls
 * automatically emit structured JSON via pino. Zero changes to existing code.
 *
 * Handles both:
 *   console.log("simple string")
 *   console.log(JSON.stringify({ event: "foo", ... }))  — already structured
 */
export function overrideConsoleWithPino(): void {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  function formatArgs(args: unknown[]): string {
    return args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  }

  function tryParseJson(msg: string): Record<string, unknown> | null {
    if (msg.startsWith("{") && msg.endsWith("}")) {
      try {
        return JSON.parse(msg);
      } catch {
        return null;
      }
    }
    return null;
  }

  console.log = (...args: unknown[]) => {
    const msg = formatArgs(args);
    const parsed = tryParseJson(msg);
    if (parsed) {
      logger.info(parsed, parsed.event as string || "log");
    } else {
      logger.info(msg);
    }
  };

  console.info = console.log;

  console.warn = (...args: unknown[]) => {
    const msg = formatArgs(args);
    const parsed = tryParseJson(msg);
    if (parsed) {
      logger.warn(parsed, parsed.event as string || "warn");
    } else {
      logger.warn(msg);
    }
  };

  console.error = (...args: unknown[]) => {
    const msg = formatArgs(args);
    const parsed = tryParseJson(msg);
    if (parsed) {
      logger.error(parsed, parsed.event as string || "error");
    } else {
      logger.error(msg);
    }
  };

  console.debug = (...args: unknown[]) => {
    const msg = formatArgs(args);
    logger.debug(msg);
  };
}
