import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnvironment, getRunMode, getVersion, isProduction, isStaging, isDeployed } from "../lib/env";

describe("env helper", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.UCM_ENV;
    delete process.env.NODE_ENV;
    delete process.env.RUN_MODE;
    delete process.env.ROLE_MODE;
    delete process.env.UCM_BUILD_VERSION;
    delete process.env.BUILD_VERSION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getEnvironment", () => {
    it("returns 'development' when nothing is set", () => {
      expect(getEnvironment()).toBe("development");
    });

    it("respects UCM_ENV over NODE_ENV", () => {
      process.env.UCM_ENV = "staging";
      process.env.NODE_ENV = "production";
      expect(getEnvironment()).toBe("staging");
    });

    it("falls back to NODE_ENV when UCM_ENV is not set", () => {
      process.env.NODE_ENV = "production";
      expect(getEnvironment()).toBe("production");
    });

    it("handles staging NODE_ENV", () => {
      process.env.NODE_ENV = "staging";
      expect(getEnvironment()).toBe("staging");
    });

    it("ignores invalid UCM_ENV values", () => {
      process.env.UCM_ENV = "invalid";
      process.env.NODE_ENV = "production";
      expect(getEnvironment()).toBe("production");
    });
  });

  describe("getRunMode", () => {
    it("defaults to 'all'", () => {
      expect(getRunMode()).toBe("all");
    });

    it("reads RUN_MODE", () => {
      process.env.RUN_MODE = "api";
      expect(getRunMode()).toBe("api");
    });

    it("falls back to ROLE_MODE", () => {
      process.env.ROLE_MODE = "worker";
      expect(getRunMode()).toBe("worker");
    });
  });

  describe("getVersion", () => {
    it("defaults to 'dev'", () => {
      expect(getVersion()).toBe("dev");
    });

    it("reads UCM_BUILD_VERSION", () => {
      process.env.UCM_BUILD_VERSION = "2026.03.05";
      expect(getVersion()).toBe("2026.03.05");
    });

    it("falls back to BUILD_VERSION", () => {
      process.env.BUILD_VERSION = "1.0.0";
      expect(getVersion()).toBe("1.0.0");
    });
  });

  describe("boolean helpers", () => {
    it("isProduction is true only for production", () => {
      process.env.UCM_ENV = "production";
      expect(isProduction()).toBe(true);
      expect(isStaging()).toBe(false);
      expect(isDeployed()).toBe(true);
    });

    it("isStaging is true only for staging", () => {
      process.env.UCM_ENV = "staging";
      expect(isStaging()).toBe(true);
      expect(isProduction()).toBe(false);
      expect(isDeployed()).toBe(true);
    });

    it("isDeployed is false for development", () => {
      expect(isDeployed()).toBe(false);
    });
  });
});
