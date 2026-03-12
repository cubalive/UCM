import type { Request, Response } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import {
  pharmacyOrders,
  pharmacyOrderItems,
  pharmacyOrderEvents,
  pharmacies,
  patients,
  drivers,
  trips,
  deliveryProofs,
} from "@shared/schema";
import { eq, and, desc, sql, count, inArray } from "drizzle-orm";
import { getPharmacyScopeId } from "../middleware/requirePharmacyScope";

function generatePublicId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "RX-";
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function pharmacyDashboardHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    if (!pharmacyId) {
      return res.status(403).json({ message: "Pharmacy scope required" });
    }

    const today = new Date().toISOString().split("T")[0];

    const [statusCounts] = await Promise.all([
      db.select({
        status: pharmacyOrders.status,
        count: count(),
      })
        .from(pharmacyOrders)
        .where(and(
          eq(pharmacyOrders.pharmacyId, pharmacyId),
          eq(pharmacyOrders.requestedDeliveryDate, today),
        ))
        .groupBy(pharmacyOrders.status),
    ]);

    const allOrders = await db.select()
      .from(pharmacyOrders)
      .where(and(
        eq(pharmacyOrders.pharmacyId, pharmacyId),
        eq(pharmacyOrders.requestedDeliveryDate, today),
      ))
      .orderBy(desc(pharmacyOrders.createdAt))
      .limit(50);

    const statusMap: Record<string, number> = {};
    for (const s of statusCounts) {
      statusMap[s.status] = Number(s.count);
    }

    const totalToday = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const delivered = statusMap["DELIVERED"] || 0;
    const inTransit = (statusMap["EN_ROUTE_PICKUP"] || 0) + (statusMap["PICKED_UP"] || 0) + (statusMap["EN_ROUTE_DELIVERY"] || 0);
    const pending = (statusMap["PENDING"] || 0) + (statusMap["CONFIRMED"] || 0) + (statusMap["PREPARING"] || 0) + (statusMap["READY_FOR_PICKUP"] || 0);
    const failed = statusMap["FAILED"] || 0;

    res.json({
      today,
      summary: {
        totalToday,
        delivered,
        inTransit,
        pending,
        failed,
        deliveryRate: totalToday > 0 ? Math.round((delivered / totalToday) * 100) : 0,
      },
      statusBreakdown: statusMap,
      recentOrders: allOrders,
    });
  } catch (err: any) {
    console.error("[PharmacyDashboard]", err);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
}

// ─── Orders List ─────────────────────────────────────────────────────────────

export async function pharmacyOrdersListHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    if (!pharmacyId) {
      return res.status(403).json({ message: "Pharmacy scope required" });
    }

    const { status, date, priority, page = "1", limit = "50" } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const conditions = [eq(pharmacyOrders.pharmacyId, pharmacyId)];
    if (status && status !== "ALL") {
      conditions.push(eq(pharmacyOrders.status, status as any));
    }
    if (date) {
      conditions.push(eq(pharmacyOrders.requestedDeliveryDate, date as string));
    }
    if (priority && priority !== "ALL") {
      conditions.push(eq(pharmacyOrders.priority, priority as any));
    }

    const [orders, totalResult] = await Promise.all([
      db.select()
        .from(pharmacyOrders)
        .where(and(...conditions))
        .orderBy(desc(pharmacyOrders.createdAt))
        .limit(Number(limit))
        .offset(offset),
      db.select({ count: count() })
        .from(pharmacyOrders)
        .where(and(...conditions)),
    ]);

    res.json({
      orders,
      total: Number(totalResult[0]?.count ?? 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err: any) {
    console.error("[PharmacyOrders]", err);
    res.status(500).json({ message: "Failed to load orders" });
  }
}

// ─── Order Detail ────────────────────────────────────────────────────────────

export async function pharmacyOrderDetailHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    const orderId = Number(req.params.id);

    if (!pharmacyId) {
      return res.status(403).json({ message: "Pharmacy scope required" });
    }

    const [order] = await db.select()
      .from(pharmacyOrders)
      .where(and(
        eq(pharmacyOrders.id, orderId),
        eq(pharmacyOrders.pharmacyId, pharmacyId),
      ))
      .limit(1);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const [items, events] = await Promise.all([
      db.select()
        .from(pharmacyOrderItems)
        .where(eq(pharmacyOrderItems.orderId, orderId)),
      db.select()
        .from(pharmacyOrderEvents)
        .where(eq(pharmacyOrderEvents.orderId, orderId))
        .orderBy(desc(pharmacyOrderEvents.createdAt)),
    ]);

    // If order has a driver assigned, get driver info
    let driver = null;
    if (order.driverId) {
      const [d] = await db.select({
        id: drivers.id,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        phone: drivers.phone,
        photoUrl: drivers.photoUrl,
        lastLat: drivers.lastLat,
        lastLng: drivers.lastLng,
        lastSeenAt: drivers.lastSeenAt,
      })
        .from(drivers)
        .where(eq(drivers.id, order.driverId))
        .limit(1);
      driver = d || null;
    }

    res.json({ order, items, events, driver });
  } catch (err: any) {
    console.error("[PharmacyOrderDetail]", err);
    res.status(500).json({ message: "Failed to load order details" });
  }
}

// ─── Create Order ────────────────────────────────────────────────────────────

export async function pharmacyCreateOrderHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    if (!pharmacyId) {
      return res.status(403).json({ message: "Pharmacy scope required" });
    }

    // Get pharmacy info for pickup address
    const [pharmacy] = await db.select()
      .from(pharmacies)
      .where(eq(pharmacies.id, pharmacyId))
      .limit(1);

    if (!pharmacy) {
      return res.status(404).json({ message: "Pharmacy not found" });
    }

    const {
      recipientName,
      recipientPhone,
      deliveryAddress,
      deliveryLat,
      deliveryLng,
      deliveryInstructions,
      requestedDeliveryDate,
      requestedDeliveryWindow,
      priority = "STANDARD",
      deliveryType = "PHARMACY_TO_PATIENT",
      temperatureRequirement = "AMBIENT",
      requiresSignature = true,
      requiresIdVerification = false,
      isControlledSubstance = false,
      specialHandling,
      notes,
      items = [],
      patientId,
      clinicId,
    } = req.body;

    const publicId = generatePublicId();

    const [order] = await db.insert(pharmacyOrders).values({
      publicId,
      pharmacyId,
      companyId: pharmacy.companyId,
      cityId: pharmacy.cityId,
      patientId: patientId || null,
      clinicId: clinicId || null,
      status: pharmacy.autoConfirmOrders ? "CONFIRMED" : "PENDING",
      priority,
      deliveryType,
      temperatureRequirement,
      pickupAddress: pharmacy.address,
      pickupLat: pharmacy.lat,
      pickupLng: pharmacy.lng,
      deliveryAddress,
      deliveryLat,
      deliveryLng,
      deliveryInstructions,
      recipientName,
      recipientPhone,
      requestedDeliveryDate,
      requestedDeliveryWindow,
      requiresSignature,
      requiresIdVerification,
      isControlledSubstance,
      specialHandling,
      notes,
      itemCount: items.length || 1,
      itemsSummary: items.map((i: any) => i.medicationName).join(", ") || null,
      createdBy: req.user?.userId,
    }).returning();

    // Insert items if provided
    if (items.length > 0) {
      await db.insert(pharmacyOrderItems).values(
        items.map((item: any) => ({
          orderId: order.id,
          medicationName: item.medicationName,
          ndc: item.ndc || null,
          quantity: item.quantity || 1,
          unit: item.unit || "each",
          rxNumber: item.rxNumber || null,
          isControlled: item.isControlled || false,
          scheduleClass: item.scheduleClass || null,
          requiresRefrigeration: item.requiresRefrigeration || false,
          notes: item.notes || null,
        })),
      );
    }

    // Log creation event
    await db.insert(pharmacyOrderEvents).values({
      orderId: order.id,
      eventType: "ORDER_CREATED",
      description: `Order ${publicId} created`,
      performedBy: req.user?.userId,
    });

    res.status(201).json({ order });
  } catch (err: any) {
    console.error("[PharmacyCreateOrder]", err);
    res.status(500).json({ message: "Failed to create order" });
  }
}

// ─── Update Order Status ─────────────────────────────────────────────────────

export async function pharmacyUpdateOrderStatusHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    const orderId = Number(req.params.id);
    const { status, notes } = req.body;

    if (!pharmacyId) {
      return res.status(403).json({ message: "Pharmacy scope required" });
    }

    const [order] = await db.select()
      .from(pharmacyOrders)
      .where(and(
        eq(pharmacyOrders.id, orderId),
        eq(pharmacyOrders.pharmacyId, pharmacyId),
      ))
      .limit(1);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const updateData: any = { status, updatedAt: new Date() };
    if (status === "READY_FOR_PICKUP") {
      updateData.readyAt = new Date();
    } else if (status === "CANCELLED") {
      updateData.cancelledAt = new Date();
      updateData.cancelledBy = req.user?.userId;
      updateData.cancelledReason = notes;
    }

    const [updated] = await db.update(pharmacyOrders)
      .set(updateData)
      .where(eq(pharmacyOrders.id, orderId))
      .returning();

    await db.insert(pharmacyOrderEvents).values({
      orderId,
      eventType: `STATUS_${status}`,
      description: notes || `Status changed to ${status}`,
      performedBy: req.user?.userId,
    });

    res.json({ order: updated });
  } catch (err: any) {
    console.error("[PharmacyUpdateOrder]", err);
    res.status(500).json({ message: "Failed to update order" });
  }
}

// ─── Pharmacy Profile ────────────────────────────────────────────────────────

export async function pharmacyProfileHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    if (!pharmacyId) {
      return res.status(403).json({ message: "Pharmacy scope required" });
    }

    const [pharmacy] = await db.select()
      .from(pharmacies)
      .where(eq(pharmacies.id, pharmacyId))
      .limit(1);

    if (!pharmacy) {
      return res.status(404).json({ message: "Pharmacy not found" });
    }

    res.json({ pharmacy });
  } catch (err: any) {
    console.error("[PharmacyProfile]", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
}

// ─── Active Deliveries (for live tracking) ───────────────────────────────────

export async function pharmacyActiveDeliveriesHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    if (!pharmacyId) {
      return res.status(403).json({ message: "Pharmacy scope required" });
    }

    const activeStatuses = [
      "DRIVER_ASSIGNED",
      "EN_ROUTE_PICKUP",
      "PICKED_UP",
      "EN_ROUTE_DELIVERY",
    ] as const;

    const activeOrders = await db.select()
      .from(pharmacyOrders)
      .where(and(
        eq(pharmacyOrders.pharmacyId, pharmacyId),
        inArray(pharmacyOrders.status, [...activeStatuses]),
      ))
      .orderBy(pharmacyOrders.assignedAt);

    // Get driver locations for active deliveries
    const driverIds = [...new Set(activeOrders.filter(o => o.driverId).map(o => o.driverId!))];
    let driverLocations: any[] = [];
    if (driverIds.length > 0) {
      driverLocations = await db.select({
        id: drivers.id,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        phone: drivers.phone,
        photoUrl: drivers.photoUrl,
        lastLat: drivers.lastLat,
        lastLng: drivers.lastLng,
        lastSeenAt: drivers.lastSeenAt,
      })
        .from(drivers)
        .where(inArray(drivers.id, driverIds));
    }

    const driverMap = new Map(driverLocations.map(d => [d.id, d]));

    const enrichedOrders = activeOrders.map(order => ({
      ...order,
      driver: order.driverId ? driverMap.get(order.driverId) || null : null,
    }));

    res.json({ deliveries: enrichedOrders });
  } catch (err: any) {
    console.error("[PharmacyActiveDeliveries]", err);
    res.status(500).json({ message: "Failed to load active deliveries" });
  }
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export async function pharmacyMetricsHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    if (!pharmacyId) {
      return res.status(403).json({ message: "Pharmacy scope required" });
    }

    const { period = "7d" } = req.query;
    const daysBack = period === "30d" ? 30 : period === "14d" ? 14 : 7;
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const sinceStr = since.toISOString().split("T")[0];

    const dailyStats = await db
      .select({
        date: pharmacyOrders.requestedDeliveryDate,
        status: pharmacyOrders.status,
        count: count(),
      })
      .from(pharmacyOrders)
      .where(and(
        eq(pharmacyOrders.pharmacyId, pharmacyId),
        sql`${pharmacyOrders.requestedDeliveryDate} >= ${sinceStr}`,
      ))
      .groupBy(pharmacyOrders.requestedDeliveryDate, pharmacyOrders.status);

    res.json({ period, dailyStats });
  } catch (err: any) {
    console.error("[PharmacyMetrics]", err);
    res.status(500).json({ message: "Failed to load metrics" });
  }
}

// ─── Public Tracking (No Auth Required) ──────────────────────────────────────

const PHARMACY_STATUS_LABELS: Record<string, string> = {
  PENDING: "Order Received",
  CONFIRMED: "Order Confirmed",
  PREPARING: "Being Prepared",
  READY_FOR_PICKUP: "Ready for Pickup",
  DRIVER_ASSIGNED: "Driver Assigned",
  EN_ROUTE_PICKUP: "Driver Heading to Pharmacy",
  PICKED_UP: "Picked Up from Pharmacy",
  EN_ROUTE_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  FAILED: "Delivery Failed",
  CANCELLED: "Cancelled",
};

export async function pharmacyPublicTrackingHandler(req: Request, res: Response) {
  try {
    const publicId = req.params.publicId as string;
    if (!publicId || publicId.length < 5) {
      return res.status(400).json({ ok: false, message: "Invalid tracking ID" });
    }

    const [order] = await db.select()
      .from(pharmacyOrders)
      .where(eq(pharmacyOrders.publicId, publicId.toUpperCase()))
      .limit(1);

    if (!order) {
      return res.status(404).json({ ok: false, message: "Order not found" });
    }

    // Get timeline events
    const events = await db.select({
      eventType: pharmacyOrderEvents.eventType,
      description: pharmacyOrderEvents.description,
      createdAt: pharmacyOrderEvents.createdAt,
    })
      .from(pharmacyOrderEvents)
      .where(eq(pharmacyOrderEvents.orderId, order.id))
      .orderBy(desc(pharmacyOrderEvents.createdAt))
      .limit(20);

    // Get driver location if actively delivering
    let driverLocation: { name: string; lat: number | null; lng: number | null; updatedAt: string | null } | null = null;
    const activeDeliveryStatuses = ["DRIVER_ASSIGNED", "EN_ROUTE_PICKUP", "PICKED_UP", "EN_ROUTE_DELIVERY"];
    const isActiveDelivery = activeDeliveryStatuses.includes(order.status);

    if (isActiveDelivery && order.driverId) {
      const [driver] = await db.select({
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        lastLat: drivers.lastLat,
        lastLng: drivers.lastLng,
        lastSeenAt: drivers.lastSeenAt,
      })
        .from(drivers)
        .where(eq(drivers.id, order.driverId))
        .limit(1);

      if (driver) {
        driverLocation = {
          name: `${driver.firstName} ${driver.lastName}`,
          lat: driver.lastLat,
          lng: driver.lastLng,
          updatedAt: driver.lastSeenAt ? driver.lastSeenAt.toISOString() : null,
        };
      }
    }

    // Compute ETA from trip if linked
    let eta: { minutes: number | null; distanceText: string | null } | null = null;
    if (isActiveDelivery && order.tripId) {
      const [trip] = await db.select({
        lastEtaMinutes: trips.lastEtaMinutes,
        distanceMiles: trips.distanceMiles,
      })
        .from(trips)
        .where(eq(trips.id, order.tripId))
        .limit(1);

      if (trip && trip.lastEtaMinutes != null) {
        eta = {
          minutes: trip.lastEtaMinutes,
          distanceText: trip.distanceMiles ? `${trip.distanceMiles} mi` : null,
        };
      }
    }

    // Build timeline from events
    const timeline = events.map(e => ({
      event: e.eventType,
      description: e.description,
      timestamp: e.createdAt.toISOString(),
    }));

    res.json({
      ok: true,
      order: {
        publicId: order.publicId,
        status: order.status,
        statusLabel: PHARMACY_STATUS_LABELS[order.status] || order.status,
        priority: order.priority,
        deliveryAddress: order.deliveryAddress,
        recipientName: order.recipientName,
        requestedDeliveryDate: order.requestedDeliveryDate,
        requestedDeliveryWindow: order.requestedDeliveryWindow,
        itemCount: order.itemCount,
        itemsSummary: order.itemsSummary,
        createdAt: order.createdAt.toISOString(),
        deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
      },
      driver: driverLocation,
      eta,
      timeline,
    });
  } catch (err: any) {
    console.error("[PharmacyPublicTracking]", err);
    res.status(500).json({ ok: false, message: "Internal error" });
  }
}

// ─── Generate Optimized Routes ────────────────────────────────────────────────

export async function pharmacyGenerateRoutesHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    if (!pharmacyId) return res.status(403).json({ message: "Pharmacy scope required" });

    const { orderIds } = req.body;
    const { generateOptimizedRoutes } = await import("../lib/pharmacyRoutingEngine");
    const routes = await generateOptimizedRoutes(pharmacyId, orderIds);

    res.json({ routes, count: routes.length });
  } catch (err: any) {
    console.error("[PharmacyGenerateRoutes]", err);
    res.status(500).json({ message: err.message || "Failed to generate routes" });
  }
}

// ─── Dispatch Route ──────────────────────────────────────────────────────────

export async function pharmacyDispatchRouteHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    if (!pharmacyId) return res.status(403).json({ message: "Pharmacy scope required" });

    const { routeId, route, mode, driverId } = req.body;
    if (!routeId || !route || !mode) return res.status(400).json({ message: "routeId, route, and mode are required" });
    if (mode !== "pharmacy_driver" && mode !== "dispatch") return res.status(400).json({ message: "mode must be 'pharmacy_driver' or 'dispatch'" });
    if (mode === "pharmacy_driver" && !driverId) return res.status(400).json({ message: "driverId is required for pharmacy_driver mode" });

    const { dispatchRoute } = await import("../lib/pharmacyRoutingEngine");
    const result = await dispatchRoute(routeId, route, mode, driverId, req.user?.userId);

    // Send patient SMS notifications
    if (result.success) {
      const { notifyPatientDeliveryUpdateEnhanced } = await import("../lib/pharmacyNotifications");
      const status = mode === "pharmacy_driver" ? "DRIVER_ASSIGNED" : "READY_FOR_PICKUP";
      for (const stop of route.stops) {
        notifyPatientDeliveryUpdateEnhanced(stop.orderId, status, { etaMinutes: stop.estimatedMinutes }).catch(() => {});
      }
    }

    res.json(result);
  } catch (err: any) {
    console.error("[PharmacyDispatchRoute]", err);
    res.status(500).json({ message: err.message || "Failed to dispatch route" });
  }
}

// ─── Pharmacy Drivers List ───────────────────────────────────────────────────

export async function pharmacyDriversHandler(req: AuthRequest, res: Response) {
  try {
    const pharmacyId = getPharmacyScopeId(req);
    if (!pharmacyId) return res.status(403).json({ message: "Pharmacy scope required" });

    const [pharmacy] = await db.select().from(pharmacies).where(eq(pharmacies.id, pharmacyId)).limit(1);
    if (!pharmacy) return res.status(404).json({ message: "Pharmacy not found" });

    const availableDrivers = await db.select({
      id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName,
      phone: drivers.phone, photoUrl: drivers.photoUrl, status: drivers.status,
      lastLat: drivers.lastLat, lastLng: drivers.lastLng, lastSeenAt: drivers.lastSeenAt,
    }).from(drivers).where(and(eq(drivers.companyId, pharmacy.companyId), eq(drivers.active, true)));

    res.json({ drivers: availableDrivers });
  } catch (err: any) {
    console.error("[PharmacyDrivers]", err);
    res.status(500).json({ message: "Failed to load drivers" });
  }
}

// ─── Driver Delivery Confirmation ────────────────────────────────────────────

export async function driverDeliveryConfirmHandler(req: AuthRequest, res: Response) {
  try {
    const orderId = Number(req.params.orderId);
    const driverId = req.user?.driverId;
    if (!driverId) return res.status(403).json({ message: "Driver authentication required" });

    const { signatureBase64, signedByName, photoUrl, gpsLat, gpsLng, gpsAccuracy, idVerified, recipientName, notes } = req.body;

    const [order] = await db.select().from(pharmacyOrders)
      .where(and(eq(pharmacyOrders.id, orderId), eq(pharmacyOrders.driverId, driverId))).limit(1);
    if (!order) return res.status(404).json({ message: "Order not found or not assigned to you" });
    if (order.status === "DELIVERED") return res.status(400).json({ message: "Order already delivered" });
    if (order.isControlledSubstance && !idVerified) return res.status(400).json({ message: "ID verification required for controlled substances" });
    if (order.requiresSignature && !signatureBase64) return res.status(400).json({ message: "Signature required for this delivery" });

    const now = new Date();
    const chainEntry = {
      action: "DELIVERED", driverId, timestamp: now.toISOString(),
      gpsLat, gpsLng, signatureCollected: !!signatureBase64, idVerified: !!idVerified, photoTaken: !!photoUrl,
    };
    const existingChain = Array.isArray(order.chainOfCustodyJson) ? order.chainOfCustodyJson : [];

    const [updated] = await db.update(pharmacyOrders).set({
      status: "DELIVERED", deliveredAt: now, deliveryProofUrl: photoUrl || null,
      signatureBase64: signatureBase64 || null, signedByName: signedByName || recipientName || null,
      chainOfCustodyJson: [...existingChain, chainEntry], updatedAt: now,
    }).where(eq(pharmacyOrders.id, orderId)).returning();

    await db.insert(deliveryProofs).values({
      tripId: order.tripId || 0, pharmacyOrderId: orderId, companyId: order.companyId, driverId,
      proofType: signatureBase64 ? "SIGNATURE" : photoUrl ? "PHOTO" : "GPS_VERIFICATION",
      signatureData: signatureBase64 || null, photoUrl: photoUrl || null,
      gpsLat: gpsLat || null, gpsLng: gpsLng || null, gpsAccuracy: gpsAccuracy || null,
      idVerified: idVerified || false, recipientName: signedByName || recipientName || order.recipientName,
      notes: notes || null, collectedAt: now,
    });

    await db.insert(pharmacyOrderEvents).values({
      orderId, eventType: "DELIVERY_CONFIRMED",
      description: `Delivery confirmed by driver. ${idVerified ? "ID verified. " : ""}${signatureBase64 ? "Signature collected. " : ""}${photoUrl ? "Photo proof. " : ""}`,
      performedBy: req.user?.userId,
      metadata: { driverId, gpsLat, gpsLng, idVerified, hasSignature: !!signatureBase64, hasPhoto: !!photoUrl },
    });

    const { notifyPatientDeliveryUpdateEnhanced } = await import("../lib/pharmacyNotifications");
    notifyPatientDeliveryUpdateEnhanced(orderId, "DELIVERED").catch(() => {});

    res.json({ success: true, order: updated });
  } catch (err: any) {
    console.error("[DriverDeliveryConfirm]", err);
    res.status(500).json({ message: "Failed to confirm delivery" });
  }
}

// ─── Driver Active Pharmacy Deliveries ───────────────────────────────────────

export async function driverActiveDeliveriesHandler(req: AuthRequest, res: Response) {
  try {
    const driverId = req.user?.driverId;
    if (!driverId) return res.status(403).json({ message: "Driver authentication required" });

    const activeOrders = await db.select().from(pharmacyOrders)
      .where(and(eq(pharmacyOrders.driverId, driverId), inArray(pharmacyOrders.status, ["DRIVER_ASSIGNED", "EN_ROUTE_PICKUP", "PICKED_UP", "EN_ROUTE_DELIVERY"])))
      .orderBy(pharmacyOrders.assignedAt);

    const orderIds = activeOrders.map(o => o.id);
    let items: any[] = [];
    if (orderIds.length > 0) {
      items = await db.select().from(pharmacyOrderItems).where(inArray(pharmacyOrderItems.orderId, orderIds));
    }

    const itemsByOrder = new Map<number, any[]>();
    for (const item of items) {
      if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
      itemsByOrder.get(item.orderId)!.push(item);
    }

    res.json({ deliveries: activeOrders.map(order => ({ ...order, items: itemsByOrder.get(order.id) || [] })) });
  } catch (err: any) {
    console.error("[DriverActiveDeliveries]", err);
    res.status(500).json({ message: "Failed to load deliveries" });
  }
}

// ─── Dispatch Pharmacy Deliveries Panel ──────────────────────────────────────

export async function dispatchPharmacyDeliveriesHandler(req: AuthRequest, res: Response) {
  try {
    const { status, priority } = req.query;

    // Build conditions - show all pharmacy orders that need dispatch attention
    const conditions: any[] = [];
    if (status && status !== "ALL") {
      conditions.push(eq(pharmacyOrders.status, status as any));
    } else {
      // Default: show actionable orders
      conditions.push(inArray(pharmacyOrders.status, [
        "READY_FOR_PICKUP", "DRIVER_ASSIGNED", "EN_ROUTE_PICKUP", "PICKED_UP", "EN_ROUTE_DELIVERY", "DELIVERED", "FAILED",
      ]));
    }
    if (priority && priority !== "ALL") {
      conditions.push(eq(pharmacyOrders.priority, priority as any));
    }

    const orders = await db.select().from(pharmacyOrders)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(pharmacyOrders.createdAt))
      .limit(200);

    // Get pharmacy names
    const pharmacyIds = [...new Set(orders.map(o => o.pharmacyId))];
    let pharmacyMap = new Map<number, string>();
    if (pharmacyIds.length > 0) {
      const pharmacyList = await db.select({ id: pharmacies.id, name: pharmacies.name })
        .from(pharmacies).where(inArray(pharmacies.id, pharmacyIds));
      pharmacyMap = new Map(pharmacyList.map(p => [p.id, p.name]));
    }

    // Get driver names for assigned orders
    const driverIds = [...new Set(orders.filter(o => o.driverId).map(o => o.driverId!))];
    let driverMap = new Map<number, { firstName: string; lastName: string }>();
    if (driverIds.length > 0) {
      const driverList = await db.select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
        .from(drivers).where(inArray(drivers.id, driverIds));
      driverMap = new Map(driverList.map(d => [d.id, { firstName: d.firstName, lastName: d.lastName }]));
    }

    const enriched = orders.map(o => ({
      ...o,
      pharmacyName: pharmacyMap.get(o.pharmacyId) || "Unknown Pharmacy",
      driverName: o.driverId ? (() => { const d = driverMap.get(o.driverId!); return d ? `${d.firstName} ${d.lastName}` : null; })() : null,
    }));

    // Summary stats
    const pending = orders.filter(o => o.status === "READY_FOR_PICKUP").length;
    const inTransit = orders.filter(o => ["EN_ROUTE_PICKUP", "PICKED_UP", "EN_ROUTE_DELIVERY"].includes(o.status)).length;
    const delivered = orders.filter(o => o.status === "DELIVERED").length;
    const failed = orders.filter(o => o.status === "FAILED").length;

    res.json({
      deliveries: enriched,
      summary: { pending, inTransit, delivered, failed, total: orders.length },
    });
  } catch (err: any) {
    console.error("[DispatchPharmacyDeliveries]", err);
    res.status(500).json({ message: "Failed to load pharmacy deliveries" });
  }
}

// ─── Dispatch Assign Pharmacy Delivery ───────────────────────────────────────

export async function dispatchAssignPharmacyDeliveryHandler(req: AuthRequest, res: Response) {
  try {
    const orderId = Number(req.params.id);
    const { driverId } = req.body;

    if (!driverId) return res.status(400).json({ message: "driverId is required" });

    const [order] = await db.select().from(pharmacyOrders).where(eq(pharmacyOrders.id, orderId)).limit(1);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const [updated] = await db.update(pharmacyOrders).set({
      driverId, status: "DRIVER_ASSIGNED", assignedAt: new Date(), updatedAt: new Date(),
    }).where(eq(pharmacyOrders.id, orderId)).returning();

    await db.insert(pharmacyOrderEvents).values({
      orderId, eventType: "DISPATCH_ASSIGNED",
      description: `Dispatch assigned driver #${driverId} to order ${order.publicId}`,
      performedBy: req.user?.userId,
      metadata: { driverId, assignedBy: req.user?.userId },
    });

    // Notify patient
    const { notifyPatientDeliveryUpdateEnhanced } = await import("../lib/pharmacyNotifications");
    notifyPatientDeliveryUpdateEnhanced(orderId, "DRIVER_ASSIGNED").catch(() => {});

    // Notify driver
    const { notifyPharmacyOrderUpdate } = await import("../lib/pharmacyNotifications");
    notifyPharmacyOrderUpdate(orderId, "DRIVER_ASSIGNED").catch(() => {});

    res.json({ success: true, order: updated });
  } catch (err: any) {
    console.error("[DispatchAssignDelivery]", err);
    res.status(500).json({ message: "Failed to assign delivery" });
  }
}
