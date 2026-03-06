import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "yaml";

const specPath = path.resolve(process.cwd(), "docs/openapi.yaml");

describe("OpenAPI Specification", () => {
  it("docs/openapi.yaml exists and parses as valid YAML", () => {
    expect(fs.existsSync(specPath)).toBe(true);
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content);
    expect(spec).toBeDefined();
    expect(typeof spec).toBe("object");
  });

  it("has required OpenAPI 3.1 structure", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as Record<string, unknown>;

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(spec.components).toBeDefined();
    expect(spec.tags).toBeDefined();
    expect(spec.security).toBeDefined();
  });

  it("defines BearerAuth security scheme", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as any;

    const bearerAuth = spec.components?.securitySchemes?.BearerAuth;
    expect(bearerAuth).toBeDefined();
    expect(bearerAuth.type).toBe("http");
    expect(bearerAuth.scheme).toBe("bearer");
    expect(bearerAuth.bearerFormat).toBe("JWT");
  });

  it("defines required API tags", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as any;

    const tagNames = (spec.tags as Array<{ name: string }>).map((t) => t.name);
    expect(tagNames).toContain("Auth");
    expect(tagNames).toContain("Trips");
    expect(tagNames).toContain("Drivers");
    expect(tagNames).toContain("Clinics");
    expect(tagNames).toContain("Billing");
    expect(tagNames).toContain("Admin");
  });

  it("includes SUBSCRIPTION_INACTIVE and QUOTA_EXCEEDED error schemas", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as any;

    expect(spec.components.schemas.SubscriptionInactiveError).toBeDefined();
    expect(spec.components.schemas.QuotaExceededError).toBeDefined();

    expect(spec.components.schemas.SubscriptionInactiveError.properties.code.example).toBe(
      "SUBSCRIPTION_INACTIVE",
    );
    expect(spec.components.schemas.QuotaExceededError.properties.code.example).toBe(
      "QUOTA_EXCEEDED",
    );
  });

  it("includes key entity schemas", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as any;
    const schemas = Object.keys(spec.components.schemas);

    expect(schemas).toContain("Trip");
    expect(schemas).toContain("Driver");
    expect(schemas).toContain("Clinic");
    expect(schemas).toContain("Invoice");
    expect(schemas).toContain("LoginRequest");
    expect(schemas).toContain("LoginResponse");
    expect(schemas).toContain("DriverLocationUpdate");
  });

  it("has paths for all major route groups", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as any;
    const paths = Object.keys(spec.paths);

    // Auth
    expect(paths.some((p: string) => p.startsWith("/api/auth/"))).toBe(true);
    // Trips
    expect(paths).toContain("/api/trips");
    // Drivers
    expect(paths).toContain("/api/drivers");
    // Clinics
    expect(paths).toContain("/api/clinics");
    // Billing
    expect(paths).toContain("/api/invoices");
    // Admin
    expect(paths.some((p: string) => p.startsWith("/api/admin/"))).toBe(true);
    // Health
    expect(paths).toContain("/api/healthz");
  });

  it("has at least 20 documented paths", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as any;
    const pathCount = Object.keys(spec.paths).length;
    expect(pathCount).toBeGreaterThanOrEqual(20);
  });

  it("includes example payloads for trip creation", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as any;
    const tripPost = spec.paths["/api/trips"]?.post;
    expect(tripPost).toBeDefined();
    const body = tripPost.requestBody?.content?.["application/json"];
    expect(body?.example || body?.schema?.properties).toBeDefined();
  });

  it("includes DriverLocationUpdate schema with example coordinates", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as any;
    const driverLoc = spec.components.schemas.DriverLocationUpdate;
    expect(driverLoc.properties.latitude.example).toBe(38.8977);
    expect(driverLoc.properties.longitude.example).toBe(-77.0365);
  });

  it("includes invoice response example", () => {
    const content = fs.readFileSync(specPath, "utf-8");
    const spec = yaml.parse(content) as any;
    const invoiceGet = spec.paths["/api/invoices"]?.get;
    expect(invoiceGet).toBeDefined();
    const jsonContent = invoiceGet.responses["200"]?.content?.["application/json"];
    expect(jsonContent?.example || jsonContent?.schema).toBeDefined();
  });
});
