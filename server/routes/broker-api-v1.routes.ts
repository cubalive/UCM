/**
 * Broker External API v1 Routes
 *
 * RESTful API for external broker integrations (MTM, ModivCare, etc.)
 * All endpoints are authenticated via API key (Bearer br_xxxxx), NOT JWT.
 *
 * Base path: /api/v1/broker/
 */
import type { Express, Request, Response } from "express";
import { randomBytes, createHash } from "crypto";
import { db } from "../db";
import {
  brokers,
  brokerApiKeys,
  brokerTripRequests,
  brokerSettlements,
  brokerWebhooks,
  brokerWebhookDeliveries,
  brokerEvents,
  medicaidClaims,
  invoices,
  trips,
  drivers,
  cities,
} from "@shared/schema";
import { eq, and, desc, sql, count, gte, lte, inArray } from "drizzle-orm";
import { authenticateBrokerApi, type BrokerApiRequest } from "../lib/brokerApiAuth";
import {
  deliverWebhook,
  sendTestWebhook,
  WEBHOOK_EVENTS,
  signPayload,
} from "../lib/brokerWebhookEngine";
import { generateTripRequestPublicId } from "../lib/marketplaceEngine";
import { getJson } from "../lib/redis";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBroker(req: Request): BrokerApiRequest["broker"] {
  return (req as BrokerApiRequest).broker;
}

function paginationParams(req: Request): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
  return { limit, offset };
}

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerBrokerApiV1Routes(app: Express) {
  const prefix = "/api/v1/broker";

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STATUS & HEALTH
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  app.get(`${prefix}/status`, (_req: Request, res: Response) => {
    res.json({
      status: "healthy",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      service: "UCM Broker API",
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRIP MANAGEMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * POST /api/v1/broker/trips - Create a trip request
   */
  app.post(
    `${prefix}/trips`,
    authenticateBrokerApi("trips.create") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const body = req.body;

        // Validate required fields
        const required = ["memberName", "pickupAddress", "dropoffAddress", "requestedDate", "requestedPickupTime"];
        const missing = required.filter((f) => !body[f]);
        if (missing.length > 0) {
          return res.status(400).json({
            error: "validation_error",
            message: `Missing required fields: ${missing.join(", ")}`,
            requiredFields: required,
          });
        }

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.requestedDate)) {
          return res.status(400).json({
            error: "validation_error",
            message: "requestedDate must be in YYYY-MM-DD format",
          });
        }

        const publicId = generateTripRequestPublicId();

        const [tripRequest] = await db
          .insert(brokerTripRequests)
          .values({
            publicId,
            brokerId: broker.brokerId,
            status: "OPEN",
            memberName: body.memberName,
            memberId: body.memberId || null,
            memberPhone: body.memberPhone || null,
            memberDob: body.memberDob || null,
            pickupAddress: body.pickupAddress,
            pickupLat: body.pickupLat || null,
            pickupLng: body.pickupLng || null,
            pickupNotes: body.pickupNotes || null,
            dropoffAddress: body.dropoffAddress,
            dropoffLat: body.dropoffLat || null,
            dropoffLng: body.dropoffLng || null,
            dropoffNotes: body.dropoffNotes || null,
            requestedDate: body.requestedDate,
            requestedPickupTime: body.requestedPickupTime,
            requestedReturnTime: body.requestedReturnTime || null,
            isRoundTrip: body.isRoundTrip || false,
            serviceType: body.serviceType || "ambulatory",
            wheelchairRequired: body.wheelchairRequired || false,
            stretcherRequired: body.stretcherRequired || false,
            attendantRequired: body.attendantRequired || false,
            oxygenRequired: body.oxygenRequired || false,
            specialNeeds: body.specialNeeds || null,
            cityId: body.cityId || null,
            estimatedMiles: body.estimatedMiles || null,
            estimatedMinutes: body.estimatedMinutes || null,
            maxBudget: body.maxBudget || null,
            preauthorizationNumber: body.preauthorizationNumber || null,
            diagnosisCode: body.diagnosisCode || null,
            priority: body.priority || "STANDARD",
            urgencyLevel: body.urgencyLevel || "NORMAL",
            externalReferenceId: body.externalReferenceId || null,
            notes: body.notes || null,
            metadata: body.metadata || null,
          })
          .returning();

        // Log event
        await db.insert(brokerEvents).values({
          brokerId: broker.brokerId,
          tripRequestId: tripRequest.id,
          eventType: "TRIP_REQUEST_CREATED_VIA_API",
          description: `Trip request ${publicId} created via external API`,
          metadata: { apiKeyId: broker.apiKeyId },
        });

        // Fire webhook
        deliverWebhook(broker.brokerId, "trip.status_changed", {
          tripRequestId: tripRequest.id,
          publicId: tripRequest.publicId,
          status: "OPEN",
          previousStatus: null,
        }).catch(() => {});

        return res.status(201).json({
          id: tripRequest.id,
          publicId: tripRequest.publicId,
          status: tripRequest.status,
          memberName: tripRequest.memberName,
          pickupAddress: tripRequest.pickupAddress,
          dropoffAddress: tripRequest.dropoffAddress,
          requestedDate: tripRequest.requestedDate,
          requestedPickupTime: tripRequest.requestedPickupTime,
          createdAt: tripRequest.createdAt,
        });
      } catch (err: any) {
        console.error("[BrokerAPI] Create trip error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to create trip request" });
      }
    }) as any,
  );

  /**
   * GET /api/v1/broker/trips - List trips for this broker
   */
  app.get(
    `${prefix}/trips`,
    authenticateBrokerApi("trips.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const { limit, offset } = paginationParams(req);
        const { status, date, from, to } = req.query as Record<string, string>;

        let conditions = [eq(brokerTripRequests.brokerId, broker.brokerId)];
        if (status) {
          conditions.push(eq(brokerTripRequests.status, status as any));
        }
        if (date) {
          conditions.push(eq(brokerTripRequests.requestedDate, date));
        }
        if (from) {
          conditions.push(gte(brokerTripRequests.requestedDate, from));
        }
        if (to) {
          conditions.push(lte(brokerTripRequests.requestedDate, to));
        }

        const [results, [totalRow]] = await Promise.all([
          db
            .select()
            .from(brokerTripRequests)
            .where(and(...conditions))
            .orderBy(desc(brokerTripRequests.createdAt))
            .limit(limit)
            .offset(offset),
          db
            .select({ count: count() })
            .from(brokerTripRequests)
            .where(and(...conditions)),
        ]);

        return res.json({
          data: results.map(formatTripResponse),
          pagination: {
            total: Number(totalRow.count),
            limit,
            offset,
            hasMore: offset + limit < Number(totalRow.count),
          },
        });
      } catch (err: any) {
        console.error("[BrokerAPI] List trips error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to list trips" });
      }
    }) as any,
  );

  /**
   * GET /api/v1/broker/trips/:id - Get trip details with ETA
   */
  app.get(
    `${prefix}/trips/:id`,
    authenticateBrokerApi("trips.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const tripId = parseInt(String(req.params.id));

        if (isNaN(tripId)) {
          return res.status(400).json({ error: "validation_error", message: "Invalid trip ID" });
        }

        const [tripRequest] = await db
          .select()
          .from(brokerTripRequests)
          .where(and(eq(brokerTripRequests.id, tripId), eq(brokerTripRequests.brokerId, broker.brokerId)))
          .limit(1);

        if (!tripRequest) {
          return res.status(404).json({ error: "not_found", message: "Trip request not found" });
        }

        // If there's a linked trip, get live ETA
        let liveEta = null;
        if (tripRequest.tripId) {
          const [linkedTrip] = await db
            .select()
            .from(trips)
            .where(eq(trips.id, tripRequest.tripId))
            .limit(1);

          if (linkedTrip) {
            // Try to get cached ETA from Redis
            const etaData = await getJson<any>(`trip:${linkedTrip.id}:eta`);
            liveEta = etaData || (linkedTrip.lastEtaMinutes != null
              ? { minutes: linkedTrip.lastEtaMinutes, source: "cached" }
              : null);
          }
        }

        return res.json({
          ...formatTripResponse(tripRequest),
          eta: liveEta,
        });
      } catch (err: any) {
        console.error("[BrokerAPI] Get trip error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to get trip" });
      }
    }) as any,
  );

  /**
   * PUT /api/v1/broker/trips/:id - Update trip (only before assigned)
   */
  app.put(
    `${prefix}/trips/:id`,
    authenticateBrokerApi("trips.create") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const tripId = parseInt(String(req.params.id));

        if (isNaN(tripId)) {
          return res.status(400).json({ error: "validation_error", message: "Invalid trip ID" });
        }

        const [existing] = await db
          .select()
          .from(brokerTripRequests)
          .where(and(eq(brokerTripRequests.id, tripId), eq(brokerTripRequests.brokerId, broker.brokerId)))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ error: "not_found", message: "Trip request not found" });
        }

        // Can only update trips that haven't been assigned/in-progress/completed
        const immutableStatuses = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
        if (immutableStatuses.includes(existing.status)) {
          return res.status(409).json({
            error: "conflict",
            message: `Cannot update trip in ${existing.status} status`,
          });
        }

        const body = req.body;
        const allowedFields: Record<string, any> = {};

        // Only allow updating certain fields
        const updatable = [
          "memberName", "memberId", "memberPhone", "memberDob",
          "pickupAddress", "pickupLat", "pickupLng", "pickupNotes",
          "dropoffAddress", "dropoffLat", "dropoffLng", "dropoffNotes",
          "requestedDate", "requestedPickupTime", "requestedReturnTime",
          "serviceType", "wheelchairRequired", "stretcherRequired",
          "attendantRequired", "oxygenRequired", "specialNeeds",
          "maxBudget", "preauthorizationNumber", "diagnosisCode",
          "priority", "urgencyLevel", "notes", "externalReferenceId", "metadata",
        ];

        for (const field of updatable) {
          if (body[field] !== undefined) {
            allowedFields[field] = body[field];
          }
        }

        if (Object.keys(allowedFields).length === 0) {
          return res.status(400).json({
            error: "validation_error",
            message: "No updatable fields provided",
          });
        }

        allowedFields.updatedAt = new Date();

        const [updated] = await db
          .update(brokerTripRequests)
          .set(allowedFields)
          .where(eq(brokerTripRequests.id, tripId))
          .returning();

        await db.insert(brokerEvents).values({
          brokerId: broker.brokerId,
          tripRequestId: tripId,
          eventType: "TRIP_REQUEST_UPDATED_VIA_API",
          description: `Trip request ${existing.publicId} updated via API`,
          metadata: { apiKeyId: broker.apiKeyId, updatedFields: Object.keys(allowedFields) },
        });

        return res.json(formatTripResponse(updated));
      } catch (err: any) {
        console.error("[BrokerAPI] Update trip error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to update trip" });
      }
    }) as any,
  );

  /**
   * DELETE /api/v1/broker/trips/:id - Cancel a trip
   */
  app.delete(
    `${prefix}/trips/:id`,
    authenticateBrokerApi("trips.cancel") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const tripId = parseInt(String(req.params.id));

        if (isNaN(tripId)) {
          return res.status(400).json({ error: "validation_error", message: "Invalid trip ID" });
        }

        const [existing] = await db
          .select()
          .from(brokerTripRequests)
          .where(and(eq(brokerTripRequests.id, tripId), eq(brokerTripRequests.brokerId, broker.brokerId)))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ error: "not_found", message: "Trip request not found" });
        }

        if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
          return res.status(409).json({
            error: "conflict",
            message: `Cannot cancel trip in ${existing.status} status`,
          });
        }

        const reason = req.body?.reason || "Cancelled via broker API";

        const [cancelled] = await db
          .update(brokerTripRequests)
          .set({
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(brokerTripRequests.id, tripId))
          .returning();

        await db.insert(brokerEvents).values({
          brokerId: broker.brokerId,
          tripRequestId: tripId,
          eventType: "TRIP_REQUEST_CANCELLED_VIA_API",
          description: `Trip request ${existing.publicId} cancelled via API: ${reason}`,
          metadata: { apiKeyId: broker.apiKeyId },
        });

        // Fire webhook
        deliverWebhook(broker.brokerId, "trip.cancelled", {
          tripRequestId: cancelled.id,
          publicId: cancelled.publicId,
          status: "CANCELLED",
          previousStatus: existing.status,
          reason,
        }).catch(() => {});

        return res.json({
          id: cancelled.id,
          publicId: cancelled.publicId,
          status: "CANCELLED",
          cancelledAt: cancelled.cancelledAt,
          cancelledReason: cancelled.cancelledReason,
        });
      } catch (err: any) {
        console.error("[BrokerAPI] Cancel trip error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to cancel trip" });
      }
    }) as any,
  );

  /**
   * GET /api/v1/broker/trips/:id/tracking - Live GPS tracking data
   */
  app.get(
    `${prefix}/trips/:id/tracking`,
    authenticateBrokerApi("status.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const tripId = parseInt(String(req.params.id));

        if (isNaN(tripId)) {
          return res.status(400).json({ error: "validation_error", message: "Invalid trip ID" });
        }

        const [tripRequest] = await db
          .select()
          .from(brokerTripRequests)
          .where(and(eq(brokerTripRequests.id, tripId), eq(brokerTripRequests.brokerId, broker.brokerId)))
          .limit(1);

        if (!tripRequest) {
          return res.status(404).json({ error: "not_found", message: "Trip request not found" });
        }

        if (!tripRequest.tripId) {
          return res.json({
            tripRequestId: tripRequest.id,
            status: tripRequest.status,
            tracking: null,
            message: "Trip not yet assigned to a transport provider",
          });
        }

        const [linkedTrip] = await db
          .select()
          .from(trips)
          .where(eq(trips.id, tripRequest.tripId))
          .limit(1);

        if (!linkedTrip) {
          return res.json({
            tripRequestId: tripRequest.id,
            status: tripRequest.status,
            tracking: null,
            message: "Linked trip not found",
          });
        }

        // Get live driver location from Redis
        let driverLocation = null;
        let eta = null;

        if (linkedTrip.driverId) {
          driverLocation = await getJson<any>(`trip:${linkedTrip.id}:driver_location`);
          eta = await getJson<any>(`trip:${linkedTrip.id}:eta`);

          if (!eta && linkedTrip.lastEtaMinutes != null) {
            eta = {
              minutes: linkedTrip.lastEtaMinutes,
              source: "cached",
              updatedAt: linkedTrip.lastEtaUpdatedAt?.toISOString() || null,
            };
          }
        }

        return res.json({
          tripRequestId: tripRequest.id,
          tripId: linkedTrip.id,
          status: linkedTrip.status,
          driver: driverLocation
            ? {
                lat: driverLocation.lat,
                lng: driverLocation.lng,
                heading: driverLocation.heading || null,
                speed: driverLocation.speed || null,
                updatedAt: driverLocation.timestamp || null,
              }
            : null,
          eta,
          pickupAddress: linkedTrip.pickupAddress,
          dropoffAddress: linkedTrip.dropoffAddress,
        });
      } catch (err: any) {
        console.error("[BrokerAPI] Tracking error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to get tracking data" });
      }
    }) as any,
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CAPACITY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * GET /api/v1/broker/capacity - Check available transport capacity
   */
  app.get(
    `${prefix}/capacity`,
    authenticateBrokerApi("status.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const { date, cityId } = req.query as Record<string, string>;

        if (!date) {
          return res.status(400).json({
            error: "validation_error",
            message: "date query parameter is required (YYYY-MM-DD)",
          });
        }

        let conditions: any[] = [eq(trips.scheduledDate, date)];
        if (cityId) {
          conditions.push(eq(trips.cityId, parseInt(cityId)));
        }

        // Count scheduled trips for the date to estimate capacity
        const [tripCount] = await db
          .select({ count: count() })
          .from(trips)
          .where(and(...conditions));

        // Count available drivers
        const driverConditions: any[] = [eq(drivers.status, "ACTIVE")];
        if (cityId) {
          driverConditions.push(eq(drivers.cityId, parseInt(cityId)));
        }

        const [driverCount] = await db
          .select({ count: count() })
          .from(drivers)
          .where(and(...driverConditions));

        const totalDrivers = Number(driverCount.count);
        const scheduledTrips = Number(tripCount.count);
        // Rough estimate: each driver can handle ~8 trips per day
        const estimatedCapacity = Math.max(0, totalDrivers * 8 - scheduledTrips);

        return res.json({
          date,
          cityId: cityId ? parseInt(cityId) : null,
          activeDrivers: totalDrivers,
          scheduledTrips,
          estimatedAvailableCapacity: estimatedCapacity,
          capacityUtilization: totalDrivers > 0
            ? Math.round((scheduledTrips / (totalDrivers * 8)) * 100)
            : 0,
        });
      } catch (err: any) {
        console.error("[BrokerAPI] Capacity check error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to check capacity" });
      }
    }) as any,
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BILLING & CLAIMS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * GET /api/v1/broker/claims - List Medicaid claims for this broker
   */
  app.get(
    `${prefix}/claims`,
    authenticateBrokerApi("billing.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const { limit, offset } = paginationParams(req);
        const { status, from, to } = req.query as Record<string, string>;

        let conditions: any[] = [eq(medicaidClaims.brokerId, broker.brokerId)];
        if (status) {
          conditions.push(eq(medicaidClaims.status, status as any));
        }
        if (from) {
          conditions.push(gte(medicaidClaims.serviceDate, from));
        }
        if (to) {
          conditions.push(lte(medicaidClaims.serviceDate, to));
        }

        const [results, [totalRow]] = await Promise.all([
          db
            .select()
            .from(medicaidClaims)
            .where(and(...conditions))
            .orderBy(desc(medicaidClaims.createdAt))
            .limit(limit)
            .offset(offset),
          db
            .select({ count: count() })
            .from(medicaidClaims)
            .where(and(...conditions)),
        ]);

        return res.json({
          data: results,
          pagination: {
            total: Number(totalRow.count),
            limit,
            offset,
            hasMore: offset + limit < Number(totalRow.count),
          },
        });
      } catch (err: any) {
        console.error("[BrokerAPI] List claims error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to list claims" });
      }
    }) as any,
  );

  /**
   * GET /api/v1/broker/settlements - List settlements for this broker
   */
  app.get(
    `${prefix}/settlements`,
    authenticateBrokerApi("billing.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const { limit, offset } = paginationParams(req);
        const { status } = req.query as Record<string, string>;

        let conditions: any[] = [eq(brokerSettlements.brokerId, broker.brokerId)];
        if (status) {
          conditions.push(eq(brokerSettlements.status, status as any));
        }

        const [results, [totalRow]] = await Promise.all([
          db
            .select()
            .from(brokerSettlements)
            .where(and(...conditions))
            .orderBy(desc(brokerSettlements.createdAt))
            .limit(limit)
            .offset(offset),
          db
            .select({ count: count() })
            .from(brokerSettlements)
            .where(and(...conditions)),
        ]);

        return res.json({
          data: results,
          pagination: {
            total: Number(totalRow.count),
            limit,
            offset,
            hasMore: offset + limit < Number(totalRow.count),
          },
        });
      } catch (err: any) {
        console.error("[BrokerAPI] List settlements error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to list settlements" });
      }
    }) as any,
  );

  /**
   * GET /api/v1/broker/invoices - List invoices associated with broker trips
   */
  app.get(
    `${prefix}/invoices`,
    authenticateBrokerApi("billing.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const { limit, offset } = paginationParams(req);

        // Get trip IDs for this broker that have linked trips
        const brokerTrips = await db
          .select({ tripId: brokerTripRequests.tripId })
          .from(brokerTripRequests)
          .where(
            and(
              eq(brokerTripRequests.brokerId, broker.brokerId),
              sql`${brokerTripRequests.tripId} IS NOT NULL`,
            ),
          );

        const tripIds = brokerTrips.map((t) => t.tripId!).filter(Boolean);

        if (tripIds.length === 0) {
          return res.json({
            data: [],
            pagination: { total: 0, limit, offset, hasMore: false },
          });
        }

        const [results, [totalRow]] = await Promise.all([
          db
            .select()
            .from(invoices)
            .where(inArray(invoices.tripId, tripIds))
            .orderBy(desc(invoices.createdAt))
            .limit(limit)
            .offset(offset),
          db
            .select({ count: count() })
            .from(invoices)
            .where(inArray(invoices.tripId, tripIds)),
        ]);

        return res.json({
          data: results,
          pagination: {
            total: Number(totalRow.count),
            limit,
            offset,
            hasMore: offset + limit < Number(totalRow.count),
          },
        });
      } catch (err: any) {
        console.error("[BrokerAPI] List invoices error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to list invoices" });
      }
    }) as any,
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WEBHOOKS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * POST /api/v1/broker/webhooks - Register a new webhook
   */
  app.post(
    `${prefix}/webhooks`,
    authenticateBrokerApi("trips.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const { url, events } = req.body;

        if (!url || !events || !Array.isArray(events) || events.length === 0) {
          return res.status(400).json({
            error: "validation_error",
            message: "url and events (non-empty array) are required",
            availableEvents: WEBHOOK_EVENTS,
          });
        }

        // Validate URL format
        try {
          new URL(url);
        } catch {
          return res.status(400).json({
            error: "validation_error",
            message: "Invalid URL format",
          });
        }

        // Validate events
        const invalidEvents = events.filter((e: string) => !WEBHOOK_EVENTS.includes(e as any));
        if (invalidEvents.length > 0) {
          return res.status(400).json({
            error: "validation_error",
            message: `Invalid events: ${invalidEvents.join(", ")}`,
            availableEvents: WEBHOOK_EVENTS,
          });
        }

        // Generate a signing secret
        const secret = `whsec_${randomBytes(32).toString("hex")}`;

        const [webhook] = await db
          .insert(brokerWebhooks)
          .values({
            brokerId: broker.brokerId,
            url,
            events,
            secret,
            isActive: true,
          })
          .returning();

        return res.status(201).json({
          id: webhook.id,
          url: webhook.url,
          events: webhook.events,
          secret: webhook.secret, // Only returned on creation
          isActive: webhook.isActive,
          createdAt: webhook.createdAt,
          message: "Save the secret - it will not be shown again",
        });
      } catch (err: any) {
        console.error("[BrokerAPI] Create webhook error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to create webhook" });
      }
    }) as any,
  );

  /**
   * GET /api/v1/broker/webhooks - List webhooks
   */
  app.get(
    `${prefix}/webhooks`,
    authenticateBrokerApi("trips.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);

        const webhooks = await db
          .select({
            id: brokerWebhooks.id,
            url: brokerWebhooks.url,
            events: brokerWebhooks.events,
            isActive: brokerWebhooks.isActive,
            lastDeliveredAt: brokerWebhooks.lastDeliveredAt,
            failureCount: brokerWebhooks.failureCount,
            createdAt: brokerWebhooks.createdAt,
          })
          .from(brokerWebhooks)
          .where(eq(brokerWebhooks.brokerId, broker.brokerId))
          .orderBy(desc(brokerWebhooks.createdAt));

        return res.json({ data: webhooks });
      } catch (err: any) {
        console.error("[BrokerAPI] List webhooks error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to list webhooks" });
      }
    }) as any,
  );

  /**
   * DELETE /api/v1/broker/webhooks/:id - Remove a webhook
   */
  app.delete(
    `${prefix}/webhooks/:id`,
    authenticateBrokerApi("trips.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const webhookId = parseInt(String(req.params.id));

        if (isNaN(webhookId)) {
          return res.status(400).json({ error: "validation_error", message: "Invalid webhook ID" });
        }

        const [existing] = await db
          .select()
          .from(brokerWebhooks)
          .where(and(eq(brokerWebhooks.id, webhookId), eq(brokerWebhooks.brokerId, broker.brokerId)))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ error: "not_found", message: "Webhook not found" });
        }

        // Soft delete by deactivating
        await db
          .update(brokerWebhooks)
          .set({ isActive: false })
          .where(eq(brokerWebhooks.id, webhookId));

        return res.json({ message: "Webhook removed", id: webhookId });
      } catch (err: any) {
        console.error("[BrokerAPI] Delete webhook error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to delete webhook" });
      }
    }) as any,
  );

  /**
   * POST /api/v1/broker/webhooks/:id/test - Test webhook delivery
   */
  app.post(
    `${prefix}/webhooks/:id/test`,
    authenticateBrokerApi("trips.read") as any,
    (async (req: Request, res: Response) => {
      try {
        const broker = getBroker(req);
        const webhookId = parseInt(String(req.params.id));

        if (isNaN(webhookId)) {
          return res.status(400).json({ error: "validation_error", message: "Invalid webhook ID" });
        }

        const [existing] = await db
          .select()
          .from(brokerWebhooks)
          .where(and(eq(brokerWebhooks.id, webhookId), eq(brokerWebhooks.brokerId, broker.brokerId)))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ error: "not_found", message: "Webhook not found" });
        }

        const result = await sendTestWebhook(webhookId);

        return res.json({
          webhookId,
          url: existing.url,
          ...result,
        });
      } catch (err: any) {
        console.error("[BrokerAPI] Test webhook error:", err.message);
        return res.status(500).json({ error: "internal_error", message: "Failed to test webhook" });
      }
    }) as any,
  );
}

// ─── Response Formatters ──────────────────────────────────────────────────────

function formatTripResponse(trip: any) {
  return {
    id: trip.id,
    publicId: trip.publicId,
    status: trip.status,
    memberName: trip.memberName,
    memberId: trip.memberId,
    memberPhone: trip.memberPhone,
    pickupAddress: trip.pickupAddress,
    pickupLat: trip.pickupLat,
    pickupLng: trip.pickupLng,
    pickupNotes: trip.pickupNotes,
    dropoffAddress: trip.dropoffAddress,
    dropoffLat: trip.dropoffLat,
    dropoffLng: trip.dropoffLng,
    dropoffNotes: trip.dropoffNotes,
    requestedDate: trip.requestedDate,
    requestedPickupTime: trip.requestedPickupTime,
    requestedReturnTime: trip.requestedReturnTime,
    isRoundTrip: trip.isRoundTrip,
    serviceType: trip.serviceType,
    wheelchairRequired: trip.wheelchairRequired,
    stretcherRequired: trip.stretcherRequired,
    attendantRequired: trip.attendantRequired,
    oxygenRequired: trip.oxygenRequired,
    specialNeeds: trip.specialNeeds,
    estimatedMiles: trip.estimatedMiles,
    estimatedMinutes: trip.estimatedMinutes,
    priority: trip.priority,
    urgencyLevel: trip.urgencyLevel,
    externalReferenceId: trip.externalReferenceId,
    awardedCompanyId: trip.awardedCompanyId,
    tripId: trip.tripId,
    cancelledAt: trip.cancelledAt,
    cancelledReason: trip.cancelledReason,
    completedAt: trip.completedAt,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
}
