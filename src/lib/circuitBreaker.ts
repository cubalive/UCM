/**
 * Circuit Breaker for External Services (Stripe, etc.)
 *
 * States: CLOSED (normal) → OPEN (failing, fast-fail) → HALF_OPEN (probing)
 * Prevents cascading failures when external services are down.
 */
import logger from "./logger.js";

type CircuitState = "closed" | "open" | "half_open";

interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;     // failures before opening
  resetTimeoutMs: number;       // how long to stay open before half-open
  halfOpenMaxAttempts: number;   // successful calls in half-open to close
  timeoutMs: number;            // per-call timeout
}

interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  openedAt: number | null;
  totalCalls: number;
  totalFailures: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private halfOpenSuccesses = 0;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private openedAt: number | null = null;
  private totalCalls = 0;
  private totalFailures = 0;
  private readonly opts: CircuitBreakerOptions;

  constructor(opts: CircuitBreakerOptions) {
    this.opts = opts;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.state === "open") {
      // Check if reset timeout has elapsed
      if (this.openedAt && Date.now() - this.openedAt >= this.opts.resetTimeoutMs) {
        this.state = "half_open";
        this.halfOpenSuccesses = 0;
        logger.info(`Circuit breaker [${this.opts.name}] transitioning to half-open`);
      } else {
        throw new CircuitOpenError(this.opts.name);
      }
    }

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      this.onFailure(err);
      throw err;
    }
  }

  private async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Circuit breaker [${this.opts.name}] call timed out after ${this.opts.timeoutMs}ms`));
      }, this.opts.timeoutMs);

      fn().then(
        (result) => { clearTimeout(timer); resolve(result); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  private onSuccess(): void {
    this.lastSuccessAt = Date.now();
    this.failures = 0;

    if (this.state === "half_open") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.opts.halfOpenMaxAttempts) {
        this.state = "closed";
        this.openedAt = null;
        logger.info(`Circuit breaker [${this.opts.name}] closed (recovered)`);
      }
    }
  }

  private onFailure(err: unknown): void {
    this.failures++;
    this.totalFailures++;
    this.lastFailureAt = Date.now();

    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Circuit breaker [${this.opts.name}] failure ${this.failures}/${this.opts.failureThreshold}`, { error: msg });

    if (this.state === "half_open") {
      // Any failure in half-open reopens immediately
      this.state = "open";
      this.openedAt = Date.now();
      logger.warn(`Circuit breaker [${this.opts.name}] reopened from half-open`);
      return;
    }

    if (this.failures >= this.opts.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
      logger.error(`Circuit breaker [${this.opts.name}] OPENED after ${this.failures} failures`);
    }
  }

  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.halfOpenSuccesses,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt: this.openedAt,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
    };
  }

  isAvailable(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open" && this.openedAt && Date.now() - this.openedAt >= this.opts.resetTimeoutMs) return true;
    if (this.state === "half_open") return true;
    return false;
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.halfOpenSuccesses = 0;
    this.openedAt = null;
  }
}

export class CircuitOpenError extends Error {
  constructor(serviceName: string) {
    super(`Service ${serviceName} is temporarily unavailable (circuit breaker open). Please try again later.`);
    this.name = "CircuitOpenError";
  }
}

// ── Pre-configured circuit breakers ──────────────────────────────────

export const stripeCircuitBreaker = new CircuitBreaker({
  name: "stripe",
  failureThreshold: 5,
  resetTimeoutMs: 30_000,       // 30s before probing
  halfOpenMaxAttempts: 2,       // 2 successes to close
  timeoutMs: 15_000,            // 15s per call
});

/**
 * Wrap a Stripe API call with circuit breaker protection.
 * Usage: await withStripeProtection(() => stripe.paymentIntents.create({...}))
 */
export async function withStripeProtection<T>(fn: () => Promise<T>): Promise<T> {
  return stripeCircuitBreaker.execute(fn);
}
