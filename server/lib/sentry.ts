import * as Sentry from "@sentry/node";

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

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.UCM_BUILD_VERSION || "dev",
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

  console.log(
    JSON.stringify({
      event: "sentry_initialized",
      environment: process.env.NODE_ENV || "development",
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
