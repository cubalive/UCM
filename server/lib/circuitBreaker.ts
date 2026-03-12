import { emit } from "./domainEvents";

// ── Types ───────────────────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Time in ms before an open circuit transitions to half-open. Default: 30000 */
  resetTimeoutMs?: number;
  /** Timeout in ms for each call. Default: 10000 */
  timeoutMs?: number;
  /** Max retry attempts with exponential backoff. Default: 3 */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 1000 */
  retryBaseMs?: number;
}

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  totalCalls: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  lastStateChange?: Date;
}

// ── Global registry of all circuit breakers ─────────────────────────────────

const registry = new Map<string, CircuitBreaker>();

export function getAllCircuitBreakers(): Map<string, CircuitBreaker> {
  return registry;
}

export function getCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  for (const [name, breaker] of registry) {
    stats[name] = breaker.getStats();
  }
  return stats;
}

// ── Circuit Breaker Error ───────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  readonly circuitName: string;

  constructor(name: string) {
    super(`Circuit breaker "${name}" is OPEN — requests are being rejected`);
    this.name = "CircuitOpenError";
    this.circuitName = name;
  }
}

// ── Circuit Breaker Implementation ──────────────────────────────────────────

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private totalCalls = 0;
  private lastFailure?: Date;
  private lastSuccess?: Date;
  private lastStateChange?: Date;
  private nextRetryAt?: number;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(name: string, options?: CircuitBreakerOptions) {
    this.name = name;
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 30_000;
    this.timeoutMs = options?.timeoutMs ?? 10_000;
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryBaseMs = options?.retryBaseMs ?? 1_000;

    // Register in global registry
    registry.set(name, this);
  }

  /**
   * Execute a function through the circuit breaker with timeout and retry logic.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    // Check if circuit is OPEN
    if (this.state === "OPEN") {
      if (this.nextRetryAt && Date.now() >= this.nextRetryAt) {
        // Transition to HALF_OPEN — allow one test request
        this.transitionTo("HALF_OPEN");
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    // Execute with retries (only in CLOSED state; HALF_OPEN gets one attempt)
    const maxAttempts = this.state === "HALF_OPEN" ? 1 : this.maxRetries;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.executeWithTimeout(fn);
        this.onSuccess();
        return result;
      } catch (err: any) {
        lastError = err;

        // In HALF_OPEN, any failure re-opens the circuit immediately
        if (this.state === "HALF_OPEN") {
          this.onFailure();
          throw err;
        }

        // If not the last attempt, wait with exponential backoff
        if (attempt < maxAttempts) {
          const delayMs = this.retryBaseMs * Math.pow(2, attempt - 1);
          await sleep(delayMs);
        }
      }
    }

    // All retries exhausted
    this.onFailure();
    throw lastError!;
  }

  getState(): CircuitState {
    // Check for automatic OPEN → HALF_OPEN transition
    if (this.state === "OPEN" && this.nextRetryAt && Date.now() >= this.nextRetryAt) {
      this.transitionTo("HALF_OPEN");
    }
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    return {
      name: this.name,
      state: this.getState(),
      failures: this.failureCount,
      successes: this.successCount,
      totalCalls: this.totalCalls,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      lastStateChange: this.lastStateChange,
    };
  }

  /**
   * Manually reset the circuit to CLOSED state.
   */
  reset(): void {
    this.failureCount = 0;
    this.transitionTo("CLOSED");
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Circuit breaker "${this.name}" call timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private onSuccess(): void {
    this.successCount++;
    this.lastSuccess = new Date();

    if (this.state === "HALF_OPEN") {
      // Test request succeeded — close the circuit
      this.failureCount = 0;
      this.transitionTo("CLOSED");
    } else {
      // Reset failure count on success in CLOSED state
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailure = new Date();

    if (this.state === "HALF_OPEN") {
      // Test request failed — re-open
      this.transitionTo("OPEN");
    } else if (this.failureCount >= this.failureThreshold) {
      this.transitionTo("OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    if (previousState === newState) return;

    this.state = newState;
    this.lastStateChange = new Date();

    if (newState === "OPEN") {
      this.nextRetryAt = Date.now() + this.resetTimeoutMs;
    } else {
      this.nextRetryAt = undefined;
    }

    // Log state transition
    console.log(
      JSON.stringify({
        event: "circuit_breaker_state_change",
        name: this.name,
        from: previousState,
        to: newState,
        failures: this.failureCount,
        ts: new Date().toISOString(),
      }),
    );

    // Emit domain event (fire-and-forget)
    const eventType =
      newState === "OPEN"
        ? "circuit_breaker.opened"
        : newState === "CLOSED"
          ? "circuit_breaker.closed"
          : "circuit_breaker.half_open";

    emit(eventType as any, {
      name: this.name,
      from: previousState,
      to: newState,
      failures: this.failureCount,
    }, {
      source: "circuit_breaker",
    }).catch(() => {
      // Domain event emission is best-effort
    });
  }
}

// ── Pre-built circuit breakers for common external services ─────────────────

export const circuitBreakers = {
  stripe: new CircuitBreaker("stripe", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    timeoutMs: 15_000,
  }),
  twilio: new CircuitBreaker("twilio", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    timeoutMs: 10_000,
  }),
  googleMaps: new CircuitBreaker("google_maps", {
    failureThreshold: 5,
    resetTimeoutMs: 60_000,
    timeoutMs: 10_000,
  }),
  supabase: new CircuitBreaker("supabase", {
    failureThreshold: 3,
    resetTimeoutMs: 15_000,
    timeoutMs: 10_000,
  }),
  resend: new CircuitBreaker("resend", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    timeoutMs: 10_000,
  }),
  firebase: new CircuitBreaker("firebase", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    timeoutMs: 10_000,
  }),
};

// ── Backward-compatible functional API ──────────────────────────────────────
// These functions maintain compatibility with existing code that uses the
// old recordError/recordSuccess/isCircuitOpen pattern.

const legacyBreakers = new Map<string, CircuitBreaker>();

function getLegacyBreaker(name: string): CircuitBreaker {
  let cb = legacyBreakers.get(name);
  if (!cb) {
    cb = new CircuitBreaker(`legacy_${name}`, {
      failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || "10", 10),
      resetTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_RECOVERY_MS || "30000", 10),
    });
    legacyBreakers.set(name, cb);
  }
  return cb;
}

export function recordError(name: string): void {
  const cb = getLegacyBreaker(name);
  // Simulate a failure to increment internal counter
  cb.execute(() => Promise.reject(new Error("recorded_error"))).catch(() => {});
}

export function recordSuccess(name: string): void {
  const cb = getLegacyBreaker(name);
  cb.execute(() => Promise.resolve(true)).catch(() => {});
}

export function isCircuitOpen(name: string): boolean {
  const cb = getLegacyBreaker(name);
  return cb.getState() === "OPEN";
}

export function getCircuitBreakerStates(): Record<string, { state: string; recentErrors: number; totalTrips: number }> {
  const result: Record<string, { state: string; recentErrors: number; totalTrips: number }> = {};
  for (const [name, breaker] of registry) {
    const stats = breaker.getStats();
    result[name] = {
      state: stats.state.toLowerCase(),
      recentErrors: stats.failures,
      totalTrips: stats.totalCalls,
    };
  }
  return result;
}

// ── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
