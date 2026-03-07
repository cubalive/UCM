const WINDOW_MS = parseInt(process.env.CIRCUIT_BREAKER_WINDOW_MS || "60000", 10);
const ERROR_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || "10", 10);
const RECOVERY_MS = parseInt(process.env.CIRCUIT_BREAKER_RECOVERY_MS || "30000", 10);

type CircuitState = "closed" | "open" | "half_open";

interface CircuitBreaker {
  name: string;
  state: CircuitState;
  errors: number[];
  lastOpenedAt: number | null;
  totalTrips: number;
}

const breakers = new Map<string, CircuitBreaker>();

function getOrCreate(name: string): CircuitBreaker {
  let cb = breakers.get(name);
  if (!cb) {
    cb = { name, state: "closed", errors: [], lastOpenedAt: null, totalTrips: 0 };
    breakers.set(name, cb);
  }
  return cb;
}

function pruneErrors(cb: CircuitBreaker): void {
  const cutoff = Date.now() - WINDOW_MS;
  cb.errors = cb.errors.filter(t => t > cutoff);
}

export function recordError(name: string): void {
  const cb = getOrCreate(name);
  cb.errors.push(Date.now());
  pruneErrors(cb);

  if (cb.state === "closed" && cb.errors.length >= ERROR_THRESHOLD) {
    cb.state = "open";
    cb.lastOpenedAt = Date.now();
    cb.totalTrips++;
    console.warn(JSON.stringify({
      event: "circuit_breaker_opened",
      breaker: name,
      errorCount: cb.errors.length,
      threshold: ERROR_THRESHOLD,
      ts: new Date().toISOString(),
    }));
  }
}

export function recordSuccess(name: string): void {
  const cb = getOrCreate(name);
  if (cb.state === "half_open") {
    cb.state = "closed";
    cb.errors = [];
    console.log(JSON.stringify({
      event: "circuit_breaker_closed",
      breaker: name,
      ts: new Date().toISOString(),
    }));
  }
}

export function isCircuitOpen(name: string): boolean {
  const cb = getOrCreate(name);
  pruneErrors(cb);

  if (cb.state === "open") {
    if (cb.lastOpenedAt && Date.now() - cb.lastOpenedAt > RECOVERY_MS) {
      cb.state = "half_open";
      return false;
    }
    return true;
  }

  if (cb.state === "half_open") {
    return false;
  }

  return false;
}

export function getCircuitBreakerStates(): Record<string, { state: CircuitState; recentErrors: number; totalTrips: number }> {
  const result: Record<string, any> = {};
  for (const [key, cb] of breakers) {
    pruneErrors(cb);
    result[key] = {
      state: cb.state,
      recentErrors: cb.errors.length,
      totalTrips: cb.totalTrips,
    };
  }
  return result;
}
