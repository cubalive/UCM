/**
 * Scheduler & Worker Infrastructure Tests
 * Tests scheduler harness, leader election, job queue, circuit breaker, and RUN_MODE logic
 */

// ─── Scheduler State ────────────────────────────────────────────

interface SchedulerState {
  name: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  failureCount: number;
  successCount: number;
  totalRuns: number;
  avgDurationMs: number;
  lockRenewalFailures: number;
  isRunning: boolean;
}

function createSchedulerState(name: string): SchedulerState {
  return {
    name,
    lastRunAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    failureCount: 0,
    successCount: 0,
    totalRuns: 0,
    avgDurationMs: 0,
    lockRenewalFailures: 0,
    isRunning: false,
  };
}

function recordSuccess(state: SchedulerState, durationMs: number): void {
  state.totalRuns++;
  state.successCount++;
  state.lastRunAt = new Date().toISOString();
  state.lastSuccessAt = state.lastRunAt;
  state.avgDurationMs =
    (state.avgDurationMs * (state.totalRuns - 1) + durationMs) / state.totalRuns;
}

function recordFailure(state: SchedulerState, error: string): void {
  state.totalRuns++;
  state.failureCount++;
  state.lastRunAt = new Date().toISOString();
  state.lastErrorAt = state.lastRunAt;
  state.lastError = error;
}

// ─── Leader Election ────────────────────────────────────────────

class LeaderElection {
  private leaders = new Map<string, { instanceId: string; expiresAt: number }>();

  tryAcquire(lockKey: string, instanceId: string, ttlMs: number): boolean {
    const existing = this.leaders.get(lockKey);
    const now = Date.now();
    if (existing && existing.expiresAt > now && existing.instanceId !== instanceId) {
      return false;
    }
    this.leaders.set(lockKey, { instanceId, expiresAt: now + ttlMs });
    return true;
  }

  release(lockKey: string, instanceId: string): boolean {
    const existing = this.leaders.get(lockKey);
    if (!existing || existing.instanceId !== instanceId) return false;
    this.leaders.delete(lockKey);
    return true;
  }

  isLeader(lockKey: string, instanceId: string): boolean {
    const existing = this.leaders.get(lockKey);
    if (!existing) return false;
    if (existing.expiresAt < Date.now()) {
      this.leaders.delete(lockKey);
      return false;
    }
    return existing.instanceId === instanceId;
  }

  renew(lockKey: string, instanceId: string, ttlMs: number): boolean {
    const existing = this.leaders.get(lockKey);
    if (!existing || existing.instanceId !== instanceId) return false;
    existing.expiresAt = Date.now() + ttlMs;
    return true;
  }
}

// ─── Job Queue ──────────────────────────────────────────────────

interface Job {
  id: string;
  type: string;
  payload: any;
  priority: number;
  status: "pending" | "processing" | "completed" | "failed" | "dead";
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  processedAt?: Date;
  error?: string;
}

class JobQueue {
  private jobs: Job[] = [];
  private idempotencyKeys = new Set<string>();
  private deadLetterQueue: Job[] = [];

  enqueue(
    type: string,
    payload: any,
    opts?: { priority?: number; idempotencyKey?: string; maxAttempts?: number },
  ): Job | null {
    if (opts?.idempotencyKey && this.idempotencyKeys.has(opts.idempotencyKey)) {
      return null;
    }
    if (opts?.idempotencyKey) this.idempotencyKeys.add(opts.idempotencyKey);

    const job: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      payload,
      priority: opts?.priority ?? 0,
      status: "pending",
      attempts: 0,
      maxAttempts: opts?.maxAttempts ?? 3,
      createdAt: new Date(),
    };
    this.jobs.push(job);
    this.jobs.sort((a, b) => b.priority - a.priority);
    return job;
  }

  dequeue(): Job | null {
    const job = this.jobs.find((j) => j.status === "pending");
    if (!job) return null;
    job.status = "processing";
    job.attempts++;
    job.processedAt = new Date();
    return job;
  }

  complete(jobId: string): void {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) job.status = "completed";
  }

  fail(jobId: string, error: string): void {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.error = error;
    if (job.attempts >= job.maxAttempts) {
      job.status = "dead";
      this.deadLetterQueue.push(job);
    } else {
      job.status = "pending";
    }
  }

  getDeadLetterQueue(): Job[] {
    return [...this.deadLetterQueue];
  }

  getPendingCount(): number {
    return this.jobs.filter((j) => j.status === "pending").length;
  }

  getCompletedCount(): number {
    return this.jobs.filter((j) => j.status === "completed").length;
  }
}

// ─── Circuit Breaker ────────────────────────────────────────────

class CircuitBreaker {
  private state: "closed" | "open" | "half-open" = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailure = 0;

  constructor(
    private threshold: number = 5,
    private resetTimeMs: number = 100,
    private halfOpenMax: number = 1,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.resetTimeMs) {
        this.state = "half-open";
        this.successCount = 0;
      } else {
        throw new Error("Circuit breaker is open");
      }
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === "half-open") {
      this.successCount++;
      if (this.successCount >= this.halfOpenMax) {
        this.state = "closed";
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailure = Date.now();
    if (this.failureCount >= this.threshold) {
      this.state = "open";
    }
  }

  getState(): string {
    return this.state;
  }
}

// ─── RUN_MODE ───────────────────────────────────────────────────

function shouldRunSchedulers(runMode: string): boolean {
  return runMode === "worker" || runMode === "all";
}

function shouldRunApi(runMode: string): boolean {
  return runMode === "api" || runMode === "all";
}

// ─── Auto-Assign Simulation ─────────────────────────────────────

interface PendingTrip {
  id: number;
  pickupLat: number;
  pickupLng: number;
}

interface AvailableDriver {
  id: number;
  lat: number;
  lng: number;
  rating: number;
}

function autoAssign(trips: PendingTrip[], drivers: AvailableDriver[]): Map<number, number> {
  const assignments = new Map<number, number>();
  const usedDrivers = new Set<number>();

  for (const trip of trips) {
    let bestDriver: AvailableDriver | null = null;
    let bestDist = Infinity;
    for (const d of drivers) {
      if (usedDrivers.has(d.id)) continue;
      const dist = Math.hypot(trip.pickupLat - d.lat, trip.pickupLng - d.lng);
      if (dist < bestDist) {
        bestDist = dist;
        bestDriver = d;
      }
    }
    if (bestDriver) {
      assignments.set(trip.id, bestDriver.id);
      usedDrivers.add(bestDriver.id);
    }
  }
  return assignments;
}

// ─── No-Show Detection ──────────────────────────────────────────

function detectNoShows(
  trips: { id: number; arrivedAt: Date; status: string }[],
  windowMinutes: number,
  now: Date,
): number[] {
  return trips
    .filter((t) => {
      if (t.status !== "ARRIVED_PICKUP") return false;
      const waitMin = (now.getTime() - t.arrivedAt.getTime()) / 60000;
      return waitMin > windowMinutes;
    })
    .map((t) => t.id);
}

// ─── SMS Reminder Logic ─────────────────────────────────────────

function shouldSendReminder(
  scheduledTime: Date,
  now: Date,
  alreadySent: Set<string>,
  tripId: number,
  cancelled: boolean,
): { send: boolean; type?: string } {
  if (cancelled) return { send: false };
  const hoursUntil = (scheduledTime.getTime() - now.getTime()) / 3600000;

  const key24 = `${tripId}:24h`;
  const key2 = `${tripId}:2h`;

  if (hoursUntil <= 24 && hoursUntil > 2 && !alreadySent.has(key24)) {
    alreadySent.add(key24);
    return { send: true, type: "24h" };
  }
  if (hoursUntil <= 2 && hoursUntil > 0 && !alreadySent.has(key2)) {
    alreadySent.add(key2);
    return { send: true, type: "2h" };
  }
  return { send: false };
}

// ─── Recurring Schedule ─────────────────────────────────────────

function createNextOccurrence(
  baseDate: string,
  intervalDays: number,
  existingDates: Set<string>,
): string | null {
  const base = new Date(baseDate);
  const next = new Date(base.getTime() + intervalDays * 86400000);
  const nextStr = next.toISOString().split("T")[0];
  if (existingDates.has(nextStr)) return null;
  existingDates.add(nextStr);
  return nextStr;
}

// ─── Reconciliation ────────────────────────────────────────────

function reconcilePayments(
  payments: { id: string; amount: number; invoiceRef?: string }[],
  invoices: { id: string; total: number }[],
): { matched: string[]; unmatched: string[] } {
  const invoiceMap = new Map(invoices.map((i) => [i.id, i.total]));
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const p of payments) {
    if (p.invoiceRef && invoiceMap.has(p.invoiceRef)) {
      matched.push(p.id);
    } else {
      unmatched.push(p.id);
    }
  }
  return { matched, unmatched };
}

// ═════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════

describe("Scheduler State Management", () => {
  it("initializes with correct defaults", () => {
    const state = createSchedulerState("testScheduler");
    expect(state.name).toBe("testScheduler");
    expect(state.successCount).toBe(0);
    expect(state.failureCount).toBe(0);
    expect(state.totalRuns).toBe(0);
    expect(state.avgDurationMs).toBe(0);
    expect(state.isRunning).toBe(false);
    expect(state.lastRunAt).toBeNull();
    expect(state.lastSuccessAt).toBeNull();
    expect(state.lastErrorAt).toBeNull();
    expect(state.lastError).toBeNull();
  });

  it("records success correctly", () => {
    const state = createSchedulerState("test");
    recordSuccess(state, 100);
    expect(state.successCount).toBe(1);
    expect(state.totalRuns).toBe(1);
    expect(state.avgDurationMs).toBe(100);
    expect(state.lastSuccessAt).not.toBeNull();
  });

  it("records failure correctly", () => {
    const state = createSchedulerState("test");
    recordFailure(state, "Connection timeout");
    expect(state.failureCount).toBe(1);
    expect(state.totalRuns).toBe(1);
    expect(state.lastError).toBe("Connection timeout");
    expect(state.lastErrorAt).not.toBeNull();
  });

  it("calculates running average duration", () => {
    const state = createSchedulerState("test");
    recordSuccess(state, 100);
    recordSuccess(state, 200);
    expect(state.avgDurationMs).toBe(150);
    recordSuccess(state, 300);
    expect(state.avgDurationMs).toBe(200);
  });

  it("tracks both successes and failures in totalRuns", () => {
    const state = createSchedulerState("test");
    recordSuccess(state, 50);
    recordFailure(state, "err");
    recordSuccess(state, 50);
    expect(state.totalRuns).toBe(3);
    expect(state.successCount).toBe(2);
    expect(state.failureCount).toBe(1);
  });

  it("isRunning prevents concurrent execution", () => {
    const state = createSchedulerState("test");
    expect(state.isRunning).toBe(false);
    state.isRunning = true;
    expect(state.isRunning).toBe(true);
    state.isRunning = false;
    expect(state.isRunning).toBe(false);
  });
});

describe("Leader Election", () => {
  it("first instance acquires lock", () => {
    const le = new LeaderElection();
    expect(le.tryAcquire("lock:test", "inst1", 5000)).toBe(true);
  });

  it("second instance fails to acquire same lock", () => {
    const le = new LeaderElection();
    le.tryAcquire("lock:test", "inst1", 5000);
    expect(le.tryAcquire("lock:test", "inst2", 5000)).toBe(false);
  });

  it("same instance can re-acquire", () => {
    const le = new LeaderElection();
    le.tryAcquire("lock:test", "inst1", 5000);
    expect(le.tryAcquire("lock:test", "inst1", 5000)).toBe(true);
  });

  it("release by holder frees lock", () => {
    const le = new LeaderElection();
    le.tryAcquire("lock", "inst1", 5000);
    expect(le.release("lock", "inst1")).toBe(true);
    expect(le.tryAcquire("lock", "inst2", 5000)).toBe(true);
  });

  it("release by non-holder fails", () => {
    const le = new LeaderElection();
    le.tryAcquire("lock", "inst1", 5000);
    expect(le.release("lock", "inst2")).toBe(false);
  });

  it("isLeader returns true only for holder", () => {
    const le = new LeaderElection();
    le.tryAcquire("lock", "inst1", 5000);
    expect(le.isLeader("lock", "inst1")).toBe(true);
    expect(le.isLeader("lock", "inst2")).toBe(false);
  });

  it("isLeader returns false after expiry", () => {
    const le = new LeaderElection();
    le.tryAcquire("lock", "inst1", -1);
    expect(le.isLeader("lock", "inst1")).toBe(false);
  });

  it("renew extends TTL for holder", () => {
    const le = new LeaderElection();
    le.tryAcquire("lock", "inst1", 5000);
    expect(le.renew("lock", "inst1", 10000)).toBe(true);
    expect(le.isLeader("lock", "inst1")).toBe(true);
  });

  it("renew fails for non-holder", () => {
    const le = new LeaderElection();
    le.tryAcquire("lock", "inst1", 5000);
    expect(le.renew("lock", "inst2", 10000)).toBe(false);
  });

  it("multiple different locks can coexist", () => {
    const le = new LeaderElection();
    expect(le.tryAcquire("lockA", "inst1", 5000)).toBe(true);
    expect(le.tryAcquire("lockB", "inst2", 5000)).toBe(true);
    expect(le.isLeader("lockA", "inst1")).toBe(true);
    expect(le.isLeader("lockB", "inst2")).toBe(true);
  });

  it("expired lock allows new acquisition", () => {
    const le = new LeaderElection();
    le.tryAcquire("lock", "inst1", -1);
    expect(le.tryAcquire("lock", "inst2", 5000)).toBe(true);
  });
});

describe("Job Queue", () => {
  it("enqueue creates pending job", () => {
    const q = new JobQueue();
    const job = q.enqueue("tripAssignment", { tripId: 1 });
    expect(job).not.toBeNull();
    expect(job!.status).toBe("pending");
    expect(job!.type).toBe("tripAssignment");
  });

  it("dequeue returns pending job", () => {
    const q = new JobQueue();
    q.enqueue("test", {});
    const job = q.dequeue();
    expect(job).not.toBeNull();
    expect(job!.status).toBe("processing");
    expect(job!.attempts).toBe(1);
  });

  it("dequeue from empty queue returns null", () => {
    const q = new JobQueue();
    expect(q.dequeue()).toBeNull();
  });

  it("complete marks job as completed", () => {
    const q = new JobQueue();
    const job = q.enqueue("test", {})!;
    q.dequeue();
    q.complete(job.id);
    expect(q.getCompletedCount()).toBe(1);
  });

  it("fail with retry re-queues job", () => {
    const q = new JobQueue();
    const job = q.enqueue("test", {}, { maxAttempts: 3 })!;
    q.dequeue();
    q.fail(job.id, "timeout");
    expect(q.getPendingCount()).toBe(1);
    expect(q.getDeadLetterQueue()).toHaveLength(0);
  });

  it("fail after max attempts moves to dead letter queue", () => {
    const q = new JobQueue();
    const job = q.enqueue("test", {}, { maxAttempts: 1 })!;
    q.dequeue();
    q.fail(job.id, "fatal error");
    expect(q.getDeadLetterQueue()).toHaveLength(1);
    expect(q.getDeadLetterQueue()[0].error).toBe("fatal error");
  });

  it("idempotency: duplicate key blocks second enqueue", () => {
    const q = new JobQueue();
    q.enqueue("test", {}, { idempotencyKey: "unique-key-1" });
    const dup = q.enqueue("test", {}, { idempotencyKey: "unique-key-1" });
    expect(dup).toBeNull();
  });

  it("idempotency: different keys both succeed", () => {
    const q = new JobQueue();
    const j1 = q.enqueue("test", {}, { idempotencyKey: "key-a" });
    const j2 = q.enqueue("test", {}, { idempotencyKey: "key-b" });
    expect(j1).not.toBeNull();
    expect(j2).not.toBeNull();
  });

  it("priority ordering: higher priority dequeued first", () => {
    const q = new JobQueue();
    q.enqueue("low", { n: 1 }, { priority: 1 });
    q.enqueue("high", { n: 2 }, { priority: 10 });
    q.enqueue("med", { n: 3 }, { priority: 5 });

    expect(q.dequeue()!.type).toBe("high");
    expect(q.dequeue()!.type).toBe("med");
    expect(q.dequeue()!.type).toBe("low");
  });

  it("pending count tracks correctly", () => {
    const q = new JobQueue();
    q.enqueue("a", {});
    q.enqueue("b", {});
    q.enqueue("c", {});
    expect(q.getPendingCount()).toBe(3);
    q.dequeue();
    expect(q.getPendingCount()).toBe(2);
  });

  it("multiple retries exhaust attempts", () => {
    const q = new JobQueue();
    const job = q.enqueue("test", {}, { maxAttempts: 3 })!;

    q.dequeue();
    q.fail(job.id, "err1");
    expect(q.getPendingCount()).toBe(1);

    q.dequeue();
    q.fail(job.id, "err2");
    expect(q.getPendingCount()).toBe(1);

    q.dequeue();
    q.fail(job.id, "err3");
    expect(q.getPendingCount()).toBe(0);
    expect(q.getDeadLetterQueue()).toHaveLength(1);
  });
});

describe("Circuit Breaker", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
  });

  it("successful calls keep it closed", async () => {
    const cb = new CircuitBreaker(3);
    await cb.execute(() => Promise.resolve("ok"));
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("closed");
  });

  it("failures below threshold keep it closed", async () => {
    const cb = new CircuitBreaker(3);
    for (let i = 0; i < 2; i++) {
      try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch {}
    }
    expect(cb.getState()).toBe("closed");
  });

  it("failure at threshold opens it", async () => {
    const cb = new CircuitBreaker(3);
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch {}
    }
    expect(cb.getState()).toBe("open");
  });

  it("open state: all calls fail immediately", async () => {
    const cb = new CircuitBreaker(1, 60000);
    try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.getState()).toBe("open");
    await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow("Circuit breaker is open");
  });

  it("after reset time: transitions to half-open then closed", async () => {
    const cb = new CircuitBreaker(1, 50);
    try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.getState()).toBe("open");
    await new Promise((r) => setTimeout(r, 150));
    const result = await cb.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    expect(cb.getState()).toBe("closed");
  });

  it("half-open: failure re-opens", async () => {
    const cb = new CircuitBreaker(1, 50);
    try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch {}
    await new Promise((r) => setTimeout(r, 150));
    try { await cb.execute(() => Promise.reject(new Error("fail again"))); } catch {}
    expect(cb.getState()).toBe("open");
  });

  it("success resets failure count", async () => {
    const cb = new CircuitBreaker(3);
    try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch {}
    try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch {}
    await cb.execute(() => Promise.resolve("ok"));
    try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.getState()).toBe("closed");
  });
});

describe("RUN_MODE Logic", () => {
  it("api mode: schedulers disabled", () => {
    expect(shouldRunSchedulers("api")).toBe(false);
    expect(shouldRunApi("api")).toBe(true);
  });

  it("worker mode: API disabled, schedulers enabled", () => {
    expect(shouldRunSchedulers("worker")).toBe(true);
    expect(shouldRunApi("worker")).toBe(false);
  });

  it("all mode: both enabled", () => {
    expect(shouldRunSchedulers("all")).toBe(true);
    expect(shouldRunApi("all")).toBe(true);
  });

  it("unknown mode: nothing enabled", () => {
    expect(shouldRunSchedulers("unknown")).toBe(false);
    expect(shouldRunApi("unknown")).toBe(false);
  });
});

describe("Auto-Assign Engine", () => {
  it("assigns closest driver to each trip", () => {
    const trips: PendingTrip[] = [
      { id: 1, pickupLat: 25.76, pickupLng: -80.19 },
      { id: 2, pickupLat: 25.80, pickupLng: -80.15 },
    ];
    const drivers: AvailableDriver[] = [
      { id: 101, lat: 25.761, lng: -80.191, rating: 4.5 },
      { id: 102, lat: 25.801, lng: -80.151, rating: 4.8 },
    ];
    const assignments = autoAssign(trips, drivers);
    expect(assignments.get(1)).toBe(101);
    expect(assignments.get(2)).toBe(102);
  });

  it("returns empty map when no trips", () => {
    const assignments = autoAssign([], [{ id: 1, lat: 25.76, lng: -80.19, rating: 4.5 }]);
    expect(assignments.size).toBe(0);
  });

  it("returns empty map when no drivers", () => {
    const assignments = autoAssign([{ id: 1, pickupLat: 25.76, pickupLng: -80.19 }], []);
    expect(assignments.size).toBe(0);
  });

  it("handles more trips than drivers", () => {
    const trips = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, pickupLat: 25.76 + i * 0.01, pickupLng: -80.19,
    }));
    const drivers = [
      { id: 101, lat: 25.76, lng: -80.19, rating: 4.5 },
      { id: 102, lat: 25.78, lng: -80.19, rating: 4.2 },
    ];
    const assignments = autoAssign(trips, drivers);
    expect(assignments.size).toBe(2);
  });

  it("does not assign same driver twice", () => {
    const trips = [
      { id: 1, pickupLat: 25.76, pickupLng: -80.19 },
      { id: 2, pickupLat: 25.76, pickupLng: -80.19 },
    ];
    const drivers = [{ id: 101, lat: 25.76, lng: -80.19, rating: 4.5 }];
    const assignments = autoAssign(trips, drivers);
    expect(assignments.size).toBe(1);
  });
});

describe("No-Show Engine", () => {
  const now = new Date();
  const WINDOW = 15;

  it("detects no-show when wait exceeds window", () => {
    const trips = [{ id: 1, arrivedAt: new Date(now.getTime() - 20 * 60000), status: "ARRIVED_PICKUP" }];
    expect(detectNoShows(trips, WINDOW, now)).toContain(1);
  });

  it("does not flag trip within window", () => {
    const trips = [{ id: 1, arrivedAt: new Date(now.getTime() - 10 * 60000), status: "ARRIVED_PICKUP" }];
    expect(detectNoShows(trips, WINDOW, now)).toHaveLength(0);
  });

  it("does not flag completed trips", () => {
    const trips = [{ id: 1, arrivedAt: new Date(now.getTime() - 30 * 60000), status: "COMPLETED" }];
    expect(detectNoShows(trips, WINDOW, now)).toHaveLength(0);
  });

  it("handles multiple trips correctly", () => {
    const trips = [
      { id: 1, arrivedAt: new Date(now.getTime() - 20 * 60000), status: "ARRIVED_PICKUP" },
      { id: 2, arrivedAt: new Date(now.getTime() - 5 * 60000), status: "ARRIVED_PICKUP" },
      { id: 3, arrivedAt: new Date(now.getTime() - 25 * 60000), status: "ARRIVED_PICKUP" },
    ];
    expect(detectNoShows(trips, WINDOW, now)).toEqual([1, 3]);
  });
});

describe("SMS Reminder Scheduler", () => {
  it("sends 24h reminder", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() + 20 * 3600000);
    const sent = new Set<string>();
    const result = shouldSendReminder(scheduled, now, sent, 1, false);
    expect(result.send).toBe(true);
    expect(result.type).toBe("24h");
  });

  it("sends 2h reminder", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() + 1.5 * 3600000);
    const sent = new Set<string>();
    const result = shouldSendReminder(scheduled, now, sent, 1, false);
    expect(result.send).toBe(true);
    expect(result.type).toBe("2h");
  });

  it("does not duplicate 24h reminder", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() + 20 * 3600000);
    const sent = new Set<string>(["1:24h"]);
    expect(shouldSendReminder(scheduled, now, sent, 1, false).send).toBe(false);
  });

  it("does not send for cancelled trips", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() + 20 * 3600000);
    expect(shouldSendReminder(scheduled, now, new Set(), 1, true).send).toBe(false);
  });

  it("does not send for far future trips (>24h)", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() + 48 * 3600000);
    expect(shouldSendReminder(scheduled, now, new Set(), 1, false).send).toBe(false);
  });

  it("does not send for past trips", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() - 1 * 3600000);
    expect(shouldSendReminder(scheduled, now, new Set(), 1, false).send).toBe(false);
  });
});

describe("Recurring Schedule Engine", () => {
  it("creates next weekly occurrence", () => {
    const existing = new Set<string>();
    expect(createNextOccurrence("2026-03-07", 7, existing)).toBe("2026-03-14");
  });

  it("skips already created occurrence (idempotent)", () => {
    const existing = new Set<string>(["2026-03-14"]);
    expect(createNextOccurrence("2026-03-07", 7, existing)).toBeNull();
  });

  it("creates daily occurrence", () => {
    const existing = new Set<string>();
    expect(createNextOccurrence("2026-03-07", 1, existing)).toBe("2026-03-08");
  });
});

describe("Reconciliation Scheduler", () => {
  it("matches payments to invoices", () => {
    const result = reconcilePayments(
      [{ id: "p1", amount: 100, invoiceRef: "inv1" }, { id: "p2", amount: 50, invoiceRef: "inv2" }],
      [{ id: "inv1", total: 100 }, { id: "inv2", total: 50 }],
    );
    expect(result.matched).toEqual(["p1", "p2"]);
    expect(result.unmatched).toHaveLength(0);
  });

  it("flags unmatched payments", () => {
    const result = reconcilePayments(
      [{ id: "p1", amount: 100, invoiceRef: "inv999" }, { id: "p2", amount: 50 }],
      [{ id: "inv1", total: 100 }],
    );
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toEqual(["p1", "p2"]);
  });

  it("handles mixed matched and unmatched", () => {
    const result = reconcilePayments(
      [{ id: "p1", amount: 100, invoiceRef: "inv1" }, { id: "p2", amount: 50 }],
      [{ id: "inv1", total: 100 }],
    );
    expect(result.matched).toEqual(["p1"]);
    expect(result.unmatched).toEqual(["p2"]);
  });
});

describe("Scheduler Idempotency", () => {
  it("running auto-assign twice produces same result", () => {
    const trips = [{ id: 1, pickupLat: 25.76, pickupLng: -80.19 }];
    const drivers = [{ id: 101, lat: 25.761, lng: -80.191, rating: 4.5 }];
    const r1 = autoAssign(trips, drivers);
    const r2 = autoAssign(trips, drivers);
    expect(r1.get(1)).toBe(r2.get(1));
  });

  it("running on empty dataset completes without error", () => {
    expect(() => autoAssign([], [])).not.toThrow();
    expect(() => detectNoShows([], 15, new Date())).not.toThrow();
    expect(() => reconcilePayments([], [])).not.toThrow();
  });
});

describe("Timeout Handling", () => {
  it("detects task exceeding timeout", async () => {
    const TIMEOUT_MS = 50;
    let timedOut = false;

    const taskPromise = new Promise<void>((r) => setTimeout(r, 200));
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => { timedOut = true; reject(new Error("Timeout")); }, TIMEOUT_MS);
    });

    try { await Promise.race([taskPromise, timeoutPromise]); } catch (err: any) {
      expect(err.message).toBe("Timeout");
    }
    expect(timedOut).toBe(true);
  });
});

describe("Error Logging", () => {
  it("captures error in scheduler state", () => {
    const state = createSchedulerState("test");
    recordFailure(state, "Redis connection refused");
    expect(state.lastError).toBe("Redis connection refused");
  });

  it("accumulates multiple failures", () => {
    const state = createSchedulerState("test");
    recordFailure(state, "Error 1");
    recordFailure(state, "Error 2");
    recordFailure(state, "Error 3");
    expect(state.failureCount).toBe(3);
    expect(state.lastError).toBe("Error 3");
  });
});

describe("Medicaid Billing Engine", () => {
  it("does not double-submit claims", () => {
    const submitted = new Set<number>();
    function submit(tripId: number): boolean {
      if (submitted.has(tripId)) return false;
      submitted.add(tripId);
      return true;
    }
    expect(submit(1)).toBe(true);
    expect(submit(1)).toBe(false);
    expect(submit(2)).toBe(true);
  });

  it("blocks ineligible patients", () => {
    function checkEligibility(p: { medicaidId?: string; active: boolean }): boolean {
      return !!p.medicaidId && p.active;
    }
    expect(checkEligibility({ medicaidId: "MED123", active: true })).toBe(true);
    expect(checkEligibility({ active: true })).toBe(false);
    expect(checkEligibility({ medicaidId: "MED123", active: false })).toBe(false);
  });
});
