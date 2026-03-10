import type { Response } from "express";
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

    const [order] = await db.select()
      .from(pharmacyOrders)
      .where(and(
        eq(pharmacyOrders.id, orderId),
        pharmacyId ? eq(pharmacyOrders.pharmacyId, pharmacyId) : sql`true`,
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

    const [order] = await db.select()
      .from(pharmacyOrders)
      .where(and(
        eq(pharmacyOrders.id, orderId),
        pharmacyId ? eq(pharmacyOrders.pharmacyId, pharmacyId) : sql`true`,
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
