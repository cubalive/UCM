import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Mock DB layer
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectWhere = vi.fn();
const mockUpdateReturning = vi.fn();

vi.mock("../db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockInsertReturning,
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: mockSelectWhere,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: mockUpdateReturning,
        })),
      })),
    })),
  },
}));

vi.mock("../lib/systemEvents", () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/redis", () => ({
  setJson: vi.fn().mockResolvedValue(undefined),
  getJson: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(undefined),
  isRedisConnected: vi.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  generateWebhookSignature,
  WEBHOOK_EVENTS,
  enqueueWebhookJob,
  dispatchWebhookEvent,
  deliverWebhook,
  processWebhookQueue,
  _clearQueues,
  _getQueues,
  type WebhookJob,
  type WebhookEvent,
} from "../services/webhookDispatcher";

// ---------------------------------------------------------------------------
// Test: HMAC Signature Generation
// ---------------------------------------------------------------------------

describe("Webhook Signature Generation", () => {
  it("generates valid HMAC SHA256 signature", () => {
    const payload = JSON.stringify({ event: "trip.created", data: { tripId: 1 } });
    const secret = "test-secret-key";

    const signature = generateWebhookSignature(payload, secret);

    // Verify against Node crypto directly
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    expect(signature).toBe(expected);
  });

  it("produces different signatures for different payloads", () => {
    const secret = "test-secret";
    const sig1 = generateWebhookSignature('{"a":1}', secret);
    const sig2 = generateWebhookSignature('{"a":2}', secret);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const payload = '{"a":1}';
    const sig1 = generateWebhookSignature(payload, "secret-1");
    const sig2 = generateWebhookSignature(payload, "secret-2");
    expect(sig1).not.toBe(sig2);
  });

  it("produces consistent signatures for same input", () => {
    const payload = '{"event":"trip.created"}';
    const secret = "consistent-secret";
    const sig1 = generateWebhookSignature(payload, secret);
    const sig2 = generateWebhookSignature(payload, secret);
    expect(sig1).toBe(sig2);
  });

  it("signature is a 64-char hex string", () => {
    const sig = generateWebhookSignature("test", "secret");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Test: Webhook Events List
// ---------------------------------------------------------------------------

describe("Webhook Events", () => {
  it("contains all required event types", () => {
    expect(WEBHOOK_EVENTS).toContain("trip.created");
    expect(WEBHOOK_EVENTS).toContain("trip.assigned");
    expect(WEBHOOK_EVENTS).toContain("trip.started");
    expect(WEBHOOK_EVENTS).toContain("trip.completed");
    expect(WEBHOOK_EVENTS).toContain("trip.cancelled");
    expect(WEBHOOK_EVENTS).toContain("driver.location_updated");
    expect(WEBHOOK_EVENTS).toContain("invoice.created");
    expect(WEBHOOK_EVENTS).toContain("invoice.paid");
    expect(WEBHOOK_EVENTS).toContain("subscription.updated");
  });

  it("has exactly 9 event types", () => {
    expect(WEBHOOK_EVENTS).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------
// Test: Queue Operations
// ---------------------------------------------------------------------------

describe("Webhook Queue", () => {
  beforeEach(() => {
    _clearQueues();
  });

  it("enqueues a job and assigns an id", async () => {
    const jobId = await enqueueWebhookJob({
      webhookId: "wh-1",
      companyId: 1,
      eventName: "trip.created",
      payload: { tripId: 42 },
    });

    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe("string");

    const { jobQueue } = _getQueues();
    expect(jobQueue).toHaveLength(1);
    expect(jobQueue[0].webhookId).toBe("wh-1");
    expect(jobQueue[0].attempt).toBe(0);
    expect(jobQueue[0].eventName).toBe("trip.created");
  });

  it("clears queues correctly", async () => {
    await enqueueWebhookJob({
      webhookId: "wh-1",
      companyId: 1,
      eventName: "trip.created",
      payload: {},
    });

    expect(_getQueues().jobQueue).toHaveLength(1);
    _clearQueues();
    expect(_getQueues().jobQueue).toHaveLength(0);
  });

  it("maintains FIFO order", async () => {
    await enqueueWebhookJob({ webhookId: "wh-1", companyId: 1, eventName: "trip.created", payload: { order: 1 } });
    await enqueueWebhookJob({ webhookId: "wh-2", companyId: 1, eventName: "trip.assigned", payload: { order: 2 } });
    await enqueueWebhookJob({ webhookId: "wh-3", companyId: 1, eventName: "trip.completed", payload: { order: 3 } });

    const { jobQueue } = _getQueues();
    expect(jobQueue[0].webhookId).toBe("wh-1");
    expect(jobQueue[1].webhookId).toBe("wh-2");
    expect(jobQueue[2].webhookId).toBe("wh-3");
  });
});

// ---------------------------------------------------------------------------
// Test: Dispatch Event (matching webhooks)
// ---------------------------------------------------------------------------

describe("Webhook Dispatch", () => {
  beforeEach(() => {
    _clearQueues();
    vi.clearAllMocks();
  });

  it("enqueues jobs for matching webhooks", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-1", companyId: 1, url: "https://example.com/hook", secret: "s1", events: ["trip.created", "trip.completed"], active: true },
      { id: "wh-2", companyId: 1, url: "https://other.com/hook", secret: "s2", events: ["trip.assigned"], active: true },
    ]);

    await dispatchWebhookEvent(1, "trip.created", { tripId: 10 });

    const { jobQueue } = _getQueues();
    expect(jobQueue).toHaveLength(1);
    expect(jobQueue[0].webhookId).toBe("wh-1");
    expect(jobQueue[0].eventName).toBe("trip.created");
  });

  it("does not enqueue for non-matching events", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-1", companyId: 1, url: "https://example.com/hook", secret: "s1", events: ["invoice.created"], active: true },
    ]);

    await dispatchWebhookEvent(1, "trip.created", { tripId: 10 });

    const { jobQueue } = _getQueues();
    expect(jobQueue).toHaveLength(0);
  });

  it("enqueues to multiple matching webhooks", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-1", companyId: 1, url: "https://a.com/hook", secret: "s1", events: ["trip.completed"], active: true },
      { id: "wh-2", companyId: 1, url: "https://b.com/hook", secret: "s2", events: ["trip.completed"], active: true },
    ]);

    await dispatchWebhookEvent(1, "trip.completed", { tripId: 99 });

    const { jobQueue } = _getQueues();
    expect(jobQueue).toHaveLength(2);
  });

  it("handles DB errors gracefully", async () => {
    mockSelectWhere.mockRejectedValueOnce(new Error("DB connection failed"));

    // Should not throw
    await dispatchWebhookEvent(1, "trip.created", { tripId: 10 });

    const { jobQueue } = _getQueues();
    expect(jobQueue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test: Webhook Delivery
// ---------------------------------------------------------------------------

describe("Webhook Delivery", () => {
  beforeEach(() => {
    _clearQueues();
    vi.clearAllMocks();
  });

  const makeJob = (overrides?: Partial<WebhookJob>): WebhookJob => ({
    id: "job-1",
    webhookId: "wh-1",
    companyId: 1,
    eventName: "trip.created",
    payload: { tripId: 42 },
    attempt: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it("returns not found for missing webhook", async () => {
    mockSelectWhere.mockResolvedValueOnce([]);

    const result = await deliverWebhook(makeJob());
    expect(result.success).toBe(false);
    expect(result.error).toBe("webhook_not_found_or_inactive");
  });

  it("returns not found for inactive webhook", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-1", companyId: 1, url: "https://example.com", secret: "s1", events: ["trip.created"], active: false },
    ]);

    const result = await deliverWebhook(makeJob());
    expect(result.success).toBe(false);
    expect(result.error).toBe("webhook_not_found_or_inactive");
  });

  it("delivers webhook with correct headers", async () => {
    const secret = "test-secret-for-delivery";
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-1", companyId: 1, url: "https://example.com/hook", secret, events: ["trip.created"], active: true },
    ]);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("OK", { status: 200 })
    );

    const result = await deliverWebhook(makeJob());
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(options?.method).toBe("POST");

    const headers = options?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-UCM-Event"]).toBe("trip.created");
    expect(headers["X-UCM-Delivery"]).toBe("job-1");
    expect(headers["X-UCM-Signature"]).toBeDefined();

    // Verify HMAC signature is correct
    const body = options?.body as string;
    const expectedSig = generateWebhookSignature(body, secret);
    expect(headers["X-UCM-Signature"]).toBe(expectedSig);

    fetchSpy.mockRestore();
  });

  it("returns failure for non-2xx responses", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-1", companyId: 1, url: "https://example.com/hook", secret: "s1", events: ["trip.created"], active: true },
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500 })
    );

    const result = await deliverWebhook(makeJob());
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);

    vi.restoreAllMocks();
  });

  it("handles network errors", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-1", companyId: 1, url: "https://example.com/hook", secret: "s1", events: ["trip.created"], active: true },
    ]);

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const result = await deliverWebhook(makeJob());
    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Test: Retry Logic
// ---------------------------------------------------------------------------

describe("Webhook Retry Logic", () => {
  beforeEach(() => {
    _clearQueues();
    vi.clearAllMocks();
  });

  it("moves failed job to delayed queue for retry", async () => {
    // Enqueue a job
    await enqueueWebhookJob({
      webhookId: "wh-retry",
      companyId: 1,
      eventName: "trip.created",
      payload: { tripId: 1 },
    });

    // Mock: webhook lookup returns active webhook
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-retry", companyId: 1, url: "https://fail.com/hook", secret: "s1", events: ["trip.created"], active: true },
    ]);

    // Mock: fetch fails
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

    await processWebhookQueue();

    const { jobQueue, delayedQueue } = _getQueues();
    expect(jobQueue).toHaveLength(0);
    expect(delayedQueue).toHaveLength(1);
    expect(delayedQueue[0].attempt).toBe(1);
    expect(delayedQueue[0].deliverAfter).toBeDefined();

    vi.restoreAllMocks();
  });

  it("does not retry after max attempts", async () => {
    // Manually push a job at max attempts - 1 (will become MAX on process)
    const { jobQueue: jq } = _getQueues();
    jq.push({
      id: "job-exhausted",
      webhookId: "wh-exhausted",
      companyId: 1,
      eventName: "trip.created",
      payload: {},
      attempt: 4, // Will become 5 (MAX_RETRIES) on process
      createdAt: new Date().toISOString(),
    });

    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-exhausted", companyId: 1, url: "https://fail.com", secret: "s1", events: ["trip.created"], active: true },
    ]);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Still failing"));

    await processWebhookQueue();

    const { delayedQueue } = _getQueues();
    expect(delayedQueue).toHaveLength(0); // Not retried

    vi.restoreAllMocks();
  });

  it("promotes delayed jobs when ready", async () => {
    const { delayedQueue: dq, jobQueue: jq } = _getQueues();

    // Add a delayed job that's ready (deliverAfter in the past)
    dq.push({
      id: "job-delayed",
      webhookId: "wh-delayed",
      companyId: 1,
      eventName: "trip.completed",
      payload: {},
      attempt: 1,
      createdAt: new Date().toISOString(),
      deliverAfter: Date.now() - 1000, // already past
    });

    // Mock for processWebhookQueue: webhook found
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-delayed", companyId: 1, url: "https://example.com/hook", secret: "s1", events: ["trip.completed"], active: true },
    ]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("OK", { status: 200 }));

    const processed = await processWebhookQueue();
    expect(processed).toBe(1);
    expect(dq).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it("does not promote future delayed jobs", async () => {
    const { delayedQueue: dq } = _getQueues();

    dq.push({
      id: "job-future",
      webhookId: "wh-future",
      companyId: 1,
      eventName: "trip.completed",
      payload: {},
      attempt: 1,
      createdAt: new Date().toISOString(),
      deliverAfter: Date.now() + 60000, // 1 minute in the future
    });

    const processed = await processWebhookQueue();
    expect(processed).toBe(0);
    expect(dq).toHaveLength(1); // Still in delayed queue
  });
});

// ---------------------------------------------------------------------------
// Test: Payload Schema Validation
// ---------------------------------------------------------------------------

describe("Webhook Payload Schema", () => {
  it("delivery body contains event, timestamp, and data", async () => {
    const secret = "schema-test-secret";
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-schema", companyId: 1, url: "https://example.com/hook", secret, events: ["invoice.created"], active: true },
    ]);

    let capturedBody: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, options) => {
      capturedBody = options?.body as string;
      return new Response("OK", { status: 200 });
    });

    await deliverWebhook({
      id: "job-schema",
      webhookId: "wh-schema",
      companyId: 1,
      eventName: "invoice.created",
      payload: { invoiceId: 123, totalCents: 5000 },
      attempt: 1,
      createdAt: new Date().toISOString(),
    });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.event).toBe("invoice.created");
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.data).toEqual({ invoiceId: 123, totalCents: 5000 });

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Test: Tenant Isolation
// ---------------------------------------------------------------------------

describe("Webhook Tenant Isolation", () => {
  beforeEach(() => {
    _clearQueues();
    vi.clearAllMocks();
  });

  it("only dispatches to webhooks for the correct company", async () => {
    // Company 1 webhooks
    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-company1", companyId: 1, url: "https://company1.com/hook", secret: "s1", events: ["trip.created"], active: true },
    ]);

    await dispatchWebhookEvent(1, "trip.created", { tripId: 1 });

    const { jobQueue } = _getQueues();
    expect(jobQueue).toHaveLength(1);
    expect(jobQueue[0].companyId).toBe(1);
    expect(jobQueue[0].webhookId).toBe("wh-company1");
  });

  it("does not leak webhooks across companies", async () => {
    // Returns empty for company 2 (company 2 has no webhooks for this event)
    mockSelectWhere.mockResolvedValueOnce([]);

    await dispatchWebhookEvent(2, "trip.created", { tripId: 1 });

    const { jobQueue } = _getQueues();
    expect(jobQueue).toHaveLength(0);
  });

  it("job carries correct companyId", async () => {
    const jobId = await enqueueWebhookJob({
      webhookId: "wh-tenant",
      companyId: 42,
      eventName: "subscription.updated",
      payload: { status: "active" },
    });

    const { jobQueue } = _getQueues();
    const job = jobQueue.find(j => j.id === jobId);
    expect(job).toBeDefined();
    expect(job!.companyId).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Test: Exponential Backoff Calculation
// ---------------------------------------------------------------------------

describe("Exponential Backoff", () => {
  beforeEach(() => {
    _clearQueues();
    vi.clearAllMocks();
  });

  it("increases delay with each retry attempt", async () => {
    const delays: number[] = [];

    for (let attempt = 0; attempt < 4; attempt++) {
      _clearQueues();

      await enqueueWebhookJob({
        webhookId: "wh-backoff",
        companyId: 1,
        eventName: "trip.created",
        payload: {},
      });

      // Set attempt count on the job
      const { jobQueue: jq } = _getQueues();
      jq[0].attempt = attempt;

      mockSelectWhere.mockResolvedValueOnce([
        { id: "wh-backoff", companyId: 1, url: "https://fail.com", secret: "s1", events: ["trip.created"], active: true },
      ]);
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fail"));

      await processWebhookQueue();

      const { delayedQueue: dq } = _getQueues();
      if (dq.length > 0) {
        delays.push(dq[0].deliverAfter! - Date.now());
      }

      vi.restoreAllMocks();
    }

    // Each delay should be roughly double the previous (exponential backoff)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Test: Queue Worker (processWebhookQueue)
// ---------------------------------------------------------------------------

describe("Queue Worker", () => {
  beforeEach(() => {
    _clearQueues();
    vi.clearAllMocks();
  });

  it("returns 0 when queue is empty", async () => {
    const processed = await processWebhookQueue();
    expect(processed).toBe(0);
  });

  it("processes one job at a time", async () => {
    await enqueueWebhookJob({ webhookId: "wh-1", companyId: 1, eventName: "trip.created", payload: {} });
    await enqueueWebhookJob({ webhookId: "wh-2", companyId: 1, eventName: "trip.assigned", payload: {} });

    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-1", companyId: 1, url: "https://example.com", secret: "s1", events: ["trip.created"], active: true },
    ]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("OK", { status: 200 }));

    const processed = await processWebhookQueue();
    expect(processed).toBe(1);
    expect(_getQueues().jobQueue).toHaveLength(1); // Second job still waiting

    vi.restoreAllMocks();
  });

  it("successfully delivers and removes from queue", async () => {
    await enqueueWebhookJob({ webhookId: "wh-success", companyId: 1, eventName: "trip.completed", payload: { tripId: 99 } });

    mockSelectWhere.mockResolvedValueOnce([
      { id: "wh-success", companyId: 1, url: "https://example.com", secret: "s1", events: ["trip.completed"], active: true },
    ]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("OK", { status: 200 }));

    await processWebhookQueue();

    const { jobQueue, delayedQueue } = _getQueues();
    expect(jobQueue).toHaveLength(0);
    expect(delayedQueue).toHaveLength(0);

    vi.restoreAllMocks();
  });
});
