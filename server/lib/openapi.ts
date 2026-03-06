import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import type { Express } from "express";
import fs from "fs";
import path from "path";
import yaml from "yaml";

const swaggerDefinition: swaggerJsdoc.SwaggerDefinition = {
  openapi: "3.1.0",
  info: {
    title: "UCM API",
    version: "1.0.0",
    description:
      "United Care Mobility — Multi-tenant Medical Transportation Management System API. " +
      "Manages fleets, drivers, patients, trips, clinics, billing, and dispatch across multiple cities.",
    contact: {
      name: "UCM Engineering",
    },
    license: {
      name: "MIT",
    },
  },
  servers: [
    {
      url: "{protocol}://{host}",
      description: "UCM API Server",
      variables: {
        protocol: { default: "https", enum: ["https", "http"] },
        host: { default: "app.unitedcaremobility.com" },
      },
    },
  ],
  tags: [
    { name: "Auth", description: "Authentication and session management" },
    { name: "Trips", description: "Trip lifecycle management" },
    { name: "Drivers", description: "Driver management and profiles" },
    { name: "Clinics", description: "Clinic management" },
    { name: "Patients", description: "Patient management" },
    { name: "Vehicles", description: "Vehicle fleet management" },
    { name: "Billing", description: "Invoicing and billing operations" },
    { name: "Admin", description: "Administrative operations" },
    { name: "Subscriptions", description: "SaaS subscription management" },
    { name: "Onboarding", description: "Self-service tenant onboarding — company signup, trial activation, Stripe Connect" },
    { name: "Health", description: "System health and readiness checks" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "JWT authentication token. Obtain via POST /api/auth/login or POST /api/auth/login-jwt. " +
          "Multi-tenant scoping: The JWT payload includes companyId for tenant isolation. " +
          "All data-access endpoints enforce tenant boundaries automatically.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          message: { type: "string", description: "Human-readable error message" },
          code: { type: "string", description: "Machine-readable error code" },
        },
        required: ["message"],
      },
      SubscriptionInactiveError: {
        type: "object",
        properties: {
          message: { type: "string", example: "Subscription is not active" },
          code: { type: "string", example: "SUBSCRIPTION_INACTIVE" },
          companyId: { type: "integer", example: 1 },
          status: { type: "string", example: "canceled" },
          graceDaysRemaining: { type: "integer", example: 0 },
        },
        required: ["message", "code", "companyId", "status"],
      },
      QuotaExceededError: {
        type: "object",
        properties: {
          message: { type: "string", example: "Driver quota exceeded" },
          code: { type: "string", example: "QUOTA_EXCEEDED" },
          companyId: { type: "integer", example: 1 },
          limitName: { type: "string", example: "max_drivers" },
          currentUsage: { type: "integer", example: 50 },
          limitValue: { type: "integer", example: 50 },
        },
        required: ["message", "code", "companyId", "limitName", "currentUsage", "limitValue"],
      },
      Trip: {
        type: "object",
        properties: {
          id: { type: "integer" },
          companyId: { type: "integer" },
          patientId: { type: "integer" },
          driverId: { type: "integer", nullable: true },
          clinicId: { type: "integer", nullable: true },
          cityId: { type: "integer" },
          status: {
            type: "string",
            enum: [
              "SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP",
              "IN_TRANSIT", "ARRIVED_DESTINATION", "COMPLETED", "CANCELLED", "NO_SHOW",
            ],
          },
          pickupAddress: { type: "string" },
          dropoffAddress: { type: "string" },
          scheduledPickupTime: { type: "string", format: "date-time" },
          tripType: { type: "string", enum: ["ONE_WAY", "ROUND_TRIP", "WAIT_AND_RETURN"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Driver: {
        type: "object",
        properties: {
          id: { type: "integer" },
          companyId: { type: "integer" },
          userId: { type: "integer" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          phone: { type: "string" },
          email: { type: "string", format: "email" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE", "SUSPENDED"] },
          vehicleId: { type: "integer", nullable: true },
          latitude: { type: "number", format: "double", nullable: true },
          longitude: { type: "number", format: "double", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Clinic: {
        type: "object",
        properties: {
          id: { type: "integer" },
          companyId: { type: "integer" },
          name: { type: "string" },
          address: { type: "string" },
          phone: { type: "string" },
          email: { type: "string", format: "email" },
          cityId: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Invoice: {
        type: "object",
        properties: {
          id: { type: "integer" },
          companyId: { type: "integer" },
          clinicId: { type: "integer", nullable: true },
          tripId: { type: "integer", nullable: true },
          amountCents: { type: "integer" },
          status: { type: "string", enum: ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"] },
          dueDate: { type: "string", format: "date" },
          paidAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      LoginRequest: {
        type: "object",
        properties: {
          username: { type: "string", example: "admin@ucm.com" },
          password: { type: "string", example: "password123" },
        },
        required: ["username", "password"],
      },
      LoginResponse: {
        type: "object",
        properties: {
          token: { type: "string", description: "JWT access token" },
          user: {
            type: "object",
            properties: {
              id: { type: "integer" },
              username: { type: "string" },
              role: { type: "string" },
              companyId: { type: "integer", nullable: true },
            },
          },
        },
      },
      DriverLocationUpdate: {
        type: "object",
        properties: {
          latitude: { type: "number", format: "double", example: 38.8977 },
          longitude: { type: "number", format: "double", example: -77.0365 },
          heading: { type: "number", format: "double", example: 180.0 },
          speed: { type: "number", format: "double", example: 35.5 },
          accuracy: { type: "number", format: "double", example: 10.0 },
          timestamp: { type: "string", format: "date-time" },
        },
        required: ["latitude", "longitude"],
      },
    },
    responses: {
      Unauthorized: {
        description: "Authentication required — missing or invalid JWT token",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { message: "Unauthorized" },
          },
        },
      },
      Forbidden: {
        description: "Insufficient permissions for this operation",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { message: "Forbidden" },
          },
        },
      },
      SubscriptionInactive: {
        description: "Company subscription is not active (SUBSCRIPTION_INACTIVE)",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/SubscriptionInactiveError" },
          },
        },
      },
      QuotaExceeded: {
        description: "Resource quota exceeded for company (QUOTA_EXCEEDED)",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/QuotaExceededError" },
          },
        },
      },
      NotFound: {
        description: "Resource not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { message: "Not found" },
          },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
};

const options: swaggerJsdoc.Options = {
  swaggerDefinition,
  apis: [], // We use the static spec, not JSDoc annotations
};

let cachedSpec: Record<string, unknown> | null = null;

export function getOpenApiSpec(): Record<string, unknown> {
  if (cachedSpec) return cachedSpec;

  // Try to load the full spec from docs/openapi.yaml first
  const yamlPath = path.resolve(process.cwd(), "docs/openapi.yaml");
  if (fs.existsSync(yamlPath)) {
    const content = fs.readFileSync(yamlPath, "utf-8");
    cachedSpec = yaml.parse(content) as Record<string, unknown>;
    return cachedSpec;
  }

  // Fallback: generate from swagger-jsdoc definition
  cachedSpec = swaggerJsdoc(options) as Record<string, unknown>;
  return cachedSpec;
}

export function registerDocsRoutes(app: Express): void {
  const spec = getOpenApiSpec();

  // Serve the raw OpenAPI JSON spec
  app.get("/api/docs/openapi.json", (_req, res) => {
    res.json(spec);
  });

  // Serve Swagger UI at /api/docs
  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: "UCM API Documentation",
      customCss: ".swagger-ui .topbar { display: none }",
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: "list",
        filter: true,
        tagsSorter: "alpha",
      },
    }),
  );
}
