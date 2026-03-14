import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Double-click prevention / submit guard logic ────────────────────

function createSubmitGuard() {
  let isSubmitting = false;
  let lastSubmitTime = 0;
  const MIN_INTERVAL_MS = 1000;

  return {
    canSubmit(): boolean {
      const now = Date.now();
      if (isSubmitting) return false;
      if (now - lastSubmitTime < MIN_INTERVAL_MS) return false;
      return true;
    },
    startSubmit() {
      isSubmitting = true;
      lastSubmitTime = Date.now();
    },
    endSubmit() {
      isSubmitting = false;
    },
    reset() {
      isSubmitting = false;
      lastSubmitTime = 0;
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Double-Click Prevention (Submit Guard)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("allows first submit", () => {
      const guard = createSubmitGuard();
      expect(guard.canSubmit()).toBe(true);
    });
  });

  describe("during submission", () => {
    it("blocks second submit while first is in progress", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      expect(guard.canSubmit()).toBe(false);
    });

    it("blocks multiple rapid attempts during submission", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      expect(guard.canSubmit()).toBe(false);
      expect(guard.canSubmit()).toBe(false);
      expect(guard.canSubmit()).toBe(false);
    });

    it("still blocks even after interval passes if submit not ended", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      vi.advanceTimersByTime(2000);
      expect(guard.canSubmit()).toBe(false);
    });
  });

  describe("after submission completes", () => {
    it("blocks immediately after endSubmit (within interval)", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      // End submit immediately (0ms elapsed)
      guard.endSubmit();
      expect(guard.canSubmit()).toBe(false);
    });

    it("allows new submit after interval has passed", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      guard.endSubmit();
      vi.advanceTimersByTime(1001);
      expect(guard.canSubmit()).toBe(true);
    });

    it("blocks when exactly at interval boundary", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      guard.endSubmit();
      vi.advanceTimersByTime(999);
      expect(guard.canSubmit()).toBe(false);
    });
  });

  describe("rapid double-click prevention", () => {
    it("blocks second click within 1 second of first", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      guard.endSubmit();
      vi.advanceTimersByTime(500); // 500ms later
      expect(guard.canSubmit()).toBe(false);
    });

    it("allows click after 1 second cooldown", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      guard.endSubmit();
      vi.advanceTimersByTime(1100);
      expect(guard.canSubmit()).toBe(true);
    });

    it("simulates realistic double-click scenario (50ms apart)", () => {
      const guard = createSubmitGuard();
      // First click
      expect(guard.canSubmit()).toBe(true);
      guard.startSubmit();

      // Second click 50ms later
      vi.advanceTimersByTime(50);
      expect(guard.canSubmit()).toBe(false);
    });

    it("simulates triple-click scenario", () => {
      const guard = createSubmitGuard();

      // First click
      expect(guard.canSubmit()).toBe(true);
      guard.startSubmit();

      // Second click 30ms later
      vi.advanceTimersByTime(30);
      expect(guard.canSubmit()).toBe(false);

      // Third click 60ms later
      vi.advanceTimersByTime(30);
      expect(guard.canSubmit()).toBe(false);
    });
  });

  describe("reset behavior", () => {
    it("reset clears submitting state", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      expect(guard.canSubmit()).toBe(false);
      guard.reset();
      expect(guard.canSubmit()).toBe(true);
    });

    it("reset clears last submit time", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      guard.endSubmit();
      // Without reset, still within interval
      expect(guard.canSubmit()).toBe(false);
      guard.reset();
      expect(guard.canSubmit()).toBe(true);
    });

    it("can submit immediately after reset even if previously submitting", () => {
      const guard = createSubmitGuard();
      guard.startSubmit();
      guard.reset();
      expect(guard.canSubmit()).toBe(true);
      guard.startSubmit();
      expect(guard.canSubmit()).toBe(false);
    });
  });

  describe("multiple submission cycles", () => {
    it("allows multiple sequential submissions with proper spacing", () => {
      const guard = createSubmitGuard();

      // First submission
      expect(guard.canSubmit()).toBe(true);
      guard.startSubmit();
      guard.endSubmit();

      // Wait for interval
      vi.advanceTimersByTime(1100);

      // Second submission
      expect(guard.canSubmit()).toBe(true);
      guard.startSubmit();
      guard.endSubmit();

      // Wait for interval
      vi.advanceTimersByTime(1100);

      // Third submission
      expect(guard.canSubmit()).toBe(true);
    });

    it("blocks rapid re-submission after completing first", () => {
      const guard = createSubmitGuard();

      // First submission completes quickly
      guard.startSubmit();
      vi.advanceTimersByTime(100);
      guard.endSubmit();

      // Try again 200ms after start (only 100ms after end)
      vi.advanceTimersByTime(100);
      expect(guard.canSubmit()).toBe(false);
    });
  });

  describe("independent guard instances", () => {
    it("two guards operate independently", () => {
      const guard1 = createSubmitGuard();
      const guard2 = createSubmitGuard();

      guard1.startSubmit();
      expect(guard1.canSubmit()).toBe(false);
      expect(guard2.canSubmit()).toBe(true);
    });

    it("resetting one guard does not affect another", () => {
      const guard1 = createSubmitGuard();
      const guard2 = createSubmitGuard();

      guard1.startSubmit();
      guard2.startSubmit();

      guard1.reset();
      expect(guard1.canSubmit()).toBe(true);
      expect(guard2.canSubmit()).toBe(false);
    });
  });
});
