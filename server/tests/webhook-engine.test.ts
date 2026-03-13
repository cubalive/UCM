import { describe, it, expect } from "vitest";
import { signPayload, WEBHOOK_EVENTS } from "../lib/brokerWebhookEngine";

// =========================================================
// Broker Webhook Engine Tests — Pure Logic (no DB)
// =========================================================

describe("Webhook Engine — signPayload", () => {
  it("produces a valid HMAC-SHA256 hex signature", () => {
    const payload = JSON.stringify({ event: "trip.completed", data: { tripId: 1 } });
    const secret = "test-secret-key-12345";
    const signature = signPayload(payload, secret);

    expect(signature).toMatch(/^[0-9a-f]{64}$/); // SHA-256 = 64 hex chars
  });

  it("produces deterministic signatures for same input", () => {
    const payload = '{"test":true}';
    const secret = "secret";
    expect(signPayload(payload, secret)).toBe(signPayload(payload, secret));
  });

  it("produces different signatures for different payloads", () => {
    const secret = "secret";
    const sig1 = signPayload('{"a":1}', secret);
    const sig2 = signPayload('{"a":2}', secret);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const payload = '{"data":"test"}';
    const sig1 = signPayload(payload, "secret-a");
    const sig2 = signPayload(payload, "secret-b");
    expect(sig1).not.toBe(sig2);
  });

  it("handles empty payload", () => {
    const sig = signPayload("", "secret");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles unicode payload", () => {
    const sig = signPayload('{"name":"José García"}', "secret");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Webhook Engine — WEBHOOK_EVENTS", () => {
  it("defines expected event types", () => {
    expect(WEBHOOK_EVENTS).toContain("trip.status_changed");
    expect(WEBHOOK_EVENTS).toContain("trip.completed");
    expect(WEBHOOK_EVENTS).toContain("trip.cancelled");
    expect(WEBHOOK_EVENTS).toContain("trip.assigned");
    expect(WEBHOOK_EVENTS).toContain("claim.submitted");
    expect(WEBHOOK_EVENTS).toContain("settlement.ready");
  });

  it("has no duplicate events", () => {
    const unique = new Set(WEBHOOK_EVENTS);
    expect(unique.size).toBe(WEBHOOK_EVENTS.length);
  });

  it("all events follow dot-notation pattern", () => {
    for (const event of WEBHOOK_EVENTS) {
      expect(event).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});
