import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Redis module to avoid external dependencies
vi.mock("../lib/redis", () => ({
  incr: vi.fn(),
  isRedisConnected: vi.fn(),
}));

import { checkRateLimit, checkRateLimitDistributed } from "../lib/rateLimiter";
import { incr, isRedisConnected } from "../lib/redis";

const mockedIncr = vi.mocked(incr);
const mockedIsRedisConnected = vi.mocked(isRedisConnected);

describe("checkRateLimit (in-memory)", () => {
  it("allows first request", () => {
    const result = checkRateLimit("test:unique1:" + Date.now(), 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.retryAfterMs).toBe(0);
  });

  it("tracks count and decrements remaining", () => {
    const key = "test:count:" + Date.now();
    checkRateLimit(key, 5, 60);
    checkRateLimit(key, 5, 60);
    const result = checkRateLimit(key, 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("blocks after exceeding limit", () => {
    const key = "test:exceed:" + Date.now();
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 60);
    }
    const result = checkRateLimit(key, 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("different keys are independent", () => {
    const ts = Date.now();
    for (let i = 0; i < 5; i++) {
      checkRateLimit("test:a:" + ts, 5, 60);
    }
    const resultA = checkRateLimit("test:a:" + ts, 5, 60);
    const resultB = checkRateLimit("test:b:" + ts, 5, 60);
    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });
});

describe("checkRateLimitDistributed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to in-memory when Redis is not connected", async () => {
    mockedIsRedisConnected.mockReturnValue(false);
    const result = await checkRateLimitDistributed("dist:test:" + Date.now(), 5, 60);
    expect(result.allowed).toBe(true);
    expect(mockedIncr).not.toHaveBeenCalled();
  });

  it("uses Redis when connected", async () => {
    mockedIsRedisConnected.mockReturnValue(true);
    mockedIncr.mockResolvedValue(1);
    const result = await checkRateLimitDistributed("dist:redis:" + Date.now(), 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(mockedIncr).toHaveBeenCalledOnce();
  });

  it("blocks when Redis count exceeds limit", async () => {
    mockedIsRedisConnected.mockReturnValue(true);
    mockedIncr.mockResolvedValue(6);
    const result = await checkRateLimitDistributed("dist:over:" + Date.now(), 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("falls back to in-memory on Redis error", async () => {
    mockedIsRedisConnected.mockReturnValue(true);
    mockedIncr.mockRejectedValue(new Error("Redis timeout"));
    const result = await checkRateLimitDistributed("dist:error:" + Date.now(), 5, 60);
    expect(result.allowed).toBe(true); // in-memory fallback allows first request
  });

  it("passes correct key format to Redis", async () => {
    mockedIsRedisConnected.mockReturnValue(true);
    mockedIncr.mockResolvedValue(1);
    await checkRateLimitDistributed("login:1.2.3.4", 10, 300);
    expect(mockedIncr).toHaveBeenCalledWith("rl:login:1.2.3.4", 300);
  });
});
