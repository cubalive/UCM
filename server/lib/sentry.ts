import * as Sentry from "@sentry/node";
import { getEnvironment, getVersion, getRunMode } from "./env";

const SENTRY_DSN = process.env.SENTRY_DSN;

let initialized = false;

export function initSentry(): void {
  if (initialized || !SENTRY_DSN) {
    if (!SENTRY_DSN) {
      console.log(
        JSON.stringify({
          event: "sentry_skipped",
          reason: "SENTRY_DSN not set",
          ts: new Date().toISOString(),
        })
      );
    }
    return;
  }

  const ucmEnv = getEnvironment();

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ucmEnv,
    release: getVersion(),
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    beforeSend(event) {
      // Strip PII from breadcrumbs
      if (event.breadcrumbs) {
        for (const bc of event.breadcrumbs) {
          if (bc.data?.url) {
            try {
              const u = new URL(bc.data.url as string);
              u.searchParams.delete("token");
              u.searchParams.delete("key");
              bc.data.url = u.toString();
            } catch {}
          }
        }
      }
      return event;
    },
  });

  initialized = true;

  Sentry.setTag("service", getRunMode());

  console.log(
    JSON.stringify({
      event: "sentry_initialized",
      environment: ucmEnv,
      service: getRunMode(),
      ts: new Date().toISOString(),
    })
  );
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureException(err);
  });
}

export { Sentry };
