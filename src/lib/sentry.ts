import * as Sentry from "@sentry/node";
import logger from "./logger.js";

let initialized = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("Sentry disabled (no SENTRY_DSN)");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
    beforeSend(event) {
      // Strip sensitive headers
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });

  initialized = true;
  logger.info("Sentry initialized");
}

export function captureException(err: Error, context?: Record<string, unknown>) {
  if (!initialized) return;
  Sentry.captureException(err, { extra: context });
}

export function sentryFlush(timeout = 2000): Promise<boolean> {
  if (!initialized) return Promise.resolve(true);
  return Sentry.flush(timeout);
}

export { Sentry };
