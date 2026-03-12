import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";

export function registerAdminPharmacyRoutes(app: Express) {
  // List pharmacies with stats
  app.get("/api/admin/pharmacies", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN") as any, async (req: AuthRequest, res) => {
    try {
      const { db } = await import("../db");
      const { pharmacies } = await import("@shared/schema");
      const { eq, and, isNull, sql } = await import("drizzle-orm");

      const statusFilter = req.query.status ? String(req.query.status) : undefined;

      const conditions: any[] = [isNull(pharmacies.deletedAt)];
      if (statusFilter === "ACTIVE") conditions.push(eq(pharmacies.active, true));
      if (statusFilter === "INACTIVE") conditions.push(eq(pharmacies.active, false));

      const rows = await db
        .select()
        .from(pharmacies)
        .where(and(...conditions))
        .orderBy(pharmacies.name);

      // Stats
      const allRows = await db
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${pharmacies.active} = true)::int`,
          inactive: sql<number>`count(*) filter (where ${pharmacies.active} = false)::int`,
        })
        .from(pharmacies)
        .where(isNull(pharmacies.deletedAt));

      const stats = allRows[0] || { total: 0, active: 0, inactive: 0 };

      res.json({ pharmacies: rows, stats });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create pharmacy
  app.post("/api/admin/pharmacies", authMiddleware, requireRole("SUPER_ADMIN") as any, async (req: AuthRequest, res) => {
    try {
      const { db } = await import("../db");
      const { pharmacies } = await import("@shared/schema");
      const { storage } = await import("../storage");

      const caller = await storage.getUser(req.user!.userId);
      if (!caller) return res.status(401).json({ message: "Unauthorized" });

      const body = req.body;
      const publicId = `PHR-${Date.now().toString(36).toUpperCase()}`;

      const [pharmacy] = await db.insert(pharmacies).values({
        publicId,
        companyId: caller.companyId || 1,
        cityId: body.cityId || 1,
        name: body.name,
        licenseNumber: body.licenseNumber || null,
        npiNumber: body.npiNumber || null,
        address: body.address,
        phone: body.phone || null,
        email: body.email || null,
        contactName: body.contactName || null,
        operatingHoursStart: body.operatingHoursStart || "08:00",
        operatingHoursEnd: body.operatingHoursEnd || "20:00",
        acceptsControlledSubstances: body.acceptsControlledSubstances || false,
        hasRefrigeratedStorage: body.hasRefrigeratedStorage || false,
        maxDeliveryRadiusMiles: body.maxDeliveryRadiusMiles || 25,
        averagePrepTimeMinutes: body.averagePrepTimeMinutes || 30,
      }).returning();

      res.status(201).json(pharmacy);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update pharmacy (toggle active, edit fields)
  app.patch("/api/admin/pharmacies/:id", authMiddleware, requireRole("SUPER_ADMIN") as any, async (req: AuthRequest, res) => {
    try {
      const { db } = await import("../db");
      const { pharmacies } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

      const body = req.body;
      const updateData: Record<string, any> = {};

      if (body.active !== undefined) updateData.active = body.active;
      if (body.name !== undefined) updateData.name = body.name;
      if (body.address !== undefined) updateData.address = body.address;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.contactName !== undefined) updateData.contactName = body.contactName;
      if (body.licenseNumber !== undefined) updateData.licenseNumber = body.licenseNumber;
      if (body.npiNumber !== undefined) updateData.npiNumber = body.npiNumber;
      if (body.operatingHoursStart !== undefined) updateData.operatingHoursStart = body.operatingHoursStart;
      if (body.operatingHoursEnd !== undefined) updateData.operatingHoursEnd = body.operatingHoursEnd;
      if (body.acceptsControlledSubstances !== undefined) updateData.acceptsControlledSubstances = body.acceptsControlledSubstances;
      if (body.hasRefrigeratedStorage !== undefined) updateData.hasRefrigeratedStorage = body.hasRefrigeratedStorage;
      if (body.maxDeliveryRadiusMiles !== undefined) updateData.maxDeliveryRadiusMiles = body.maxDeliveryRadiusMiles;
      if (body.averagePrepTimeMinutes !== undefined) updateData.averagePrepTimeMinutes = body.averagePrepTimeMinutes;

      const [updated] = await db
        .update(pharmacies)
        .set(updateData)
        .where(eq(pharmacies.id, id))
        .returning();

      if (!updated) return res.status(404).json({ message: "Pharmacy not found" });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // List pharmacy orders (admin view across all pharmacies)
  app.get("/api/admin/pharmacy-orders", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN") as any, async (req: AuthRequest, res) => {
    try {
      const { db } = await import("../db");
      const { pharmacyOrders, pharmacies, patients } = await import("@shared/schema");
      const { eq, desc, and, sql } = await import("drizzle-orm");

      const statusFilter = req.query.status ? String(req.query.status) : undefined;
      const conditions: any[] = [];
      if (statusFilter) conditions.push(eq(pharmacyOrders.status, statusFilter as any));

      const query = db
        .select({
          id: pharmacyOrders.id,
          publicId: pharmacyOrders.publicId,
          status: pharmacyOrders.status,
          priority: pharmacyOrders.priority,
          deliveryType: pharmacyOrders.deliveryType,
          temperatureRequirement: pharmacyOrders.temperatureRequirement,
          pickupAddress: pharmacyOrders.pickupAddress,
          deliveryAddress: pharmacyOrders.deliveryAddress,
          recipientName: pharmacyOrders.recipientName,
          recipientPhone: pharmacyOrders.recipientPhone,
          requestedDeliveryDate: pharmacyOrders.requestedDeliveryDate,
          requestedDeliveryWindow: pharmacyOrders.requestedDeliveryWindow,
          rxNumber: pharmacyOrders.rxNumber,
          createdAt: pharmacyOrders.createdAt,
          pharmacyName: pharmacies.name,
          pharmacyId: pharmacyOrders.pharmacyId,
          patientId: pharmacyOrders.patientId,
        })
        .from(pharmacyOrders)
        .leftJoin(pharmacies, eq(pharmacyOrders.pharmacyId, pharmacies.id))
        .orderBy(desc(pharmacyOrders.createdAt))
        .limit(200);

      const rows = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      // Stats
      const statsRows = await db
        .select({
          total: sql<number>`count(*)::int`,
          pending: sql<number>`count(*) filter (where ${pharmacyOrders.status} = 'PENDING')::int`,
          confirmed: sql<number>`count(*) filter (where ${pharmacyOrders.status} = 'CONFIRMED')::int`,
          readyForPickup: sql<number>`count(*) filter (where ${pharmacyOrders.status} = 'READY_FOR_PICKUP')::int`,
          inTransit: sql<number>`count(*) filter (where ${pharmacyOrders.status} = 'IN_TRANSIT')::int`,
          delivered: sql<number>`count(*) filter (where ${pharmacyOrders.status} = 'DELIVERED')::int`,
          cancelled: sql<number>`count(*) filter (where ${pharmacyOrders.status} = 'CANCELLED')::int`,
        })
        .from(pharmacyOrders);

      res.json({ orders: rows, stats: statsRows[0] || {} });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
