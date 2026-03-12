import { Router, type Express } from "express";
import type { Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { requireTenantScope, getTenantId } from "../middleware";
import { db } from "../db";
import { invoices, ediClaims, ediClaimEvents, companies, users, trips, patients } from "@shared/schema";
import { eq, and, desc, sql, gte, lte, like, or, inArray, count } from "drizzle-orm";

const router = Router();

// ─── Notification Preferences ────────────────────────────────────────────────

const DEFAULT_NOTIFICATION_EVENTS = [
  "trip_assigned",
  "trip_completed",
  "trip_cancelled",
  "payment_received",
  "invoice_due",
  "driver_status_change",
  "new_support_message",
  "system_alert",
];

// In-memory store (per-user). In production, store in DB.
const notificationPrefsStore = new Map<number, Record<string, { sms: boolean; email: boolean; push: boolean }>>();

router.get(
  "/api/notification-preferences",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      let prefs = notificationPrefsStore.get(userId);
      if (!prefs) {
        prefs = {};
        for (const event of DEFAULT_NOTIFICATION_EVENTS) {
          prefs[event] = { sms: true, email: true, push: true };
        }
        notificationPrefsStore.set(userId, prefs);
      }
      res.json({ preferences: prefs, events: DEFAULT_NOTIFICATION_EVENTS });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.patch(
  "/api/notification-preferences",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { preferences } = req.body;
      if (!preferences || typeof preferences !== "object") {
        return res.status(400).json({ message: "preferences object is required" });
      }
      let current = notificationPrefsStore.get(userId);
      if (!current) {
        current = {};
        for (const event of DEFAULT_NOTIFICATION_EVENTS) {
          current[event] = { sms: true, email: true, push: true };
        }
      }
      // Merge
      for (const [event, channels] of Object.entries(preferences)) {
        if (DEFAULT_NOTIFICATION_EVENTS.includes(event) && channels && typeof channels === "object") {
          current[event] = { ...current[event], ...(channels as any) };
        }
      }
      notificationPrefsStore.set(userId, current);
      res.json({ preferences: current });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── SMS Templates ───────────────────────────────────────────────────────────

const defaultSmsTemplates: Array<{ id: string; name: string; template: string; variables: string[] }> = [
  { id: "trip_assigned", name: "Trip Assigned", template: "Hi {{driverName}}, you have been assigned trip {{tripId}}. Pickup: {{pickupAddress}} at {{pickupTime}}.", variables: ["driverName", "tripId", "pickupAddress", "pickupTime"] },
  { id: "trip_reminder", name: "Trip Reminder", template: "Reminder: Your ride is scheduled for {{pickupTime}}. Driver {{driverName}} will pick you up at {{pickupAddress}}.", variables: ["driverName", "pickupTime", "pickupAddress"] },
  { id: "trip_completed", name: "Trip Completed", template: "Trip {{tripId}} has been completed. Thank you for choosing UCM.", variables: ["tripId"] },
  { id: "trip_cancelled", name: "Trip Cancelled", template: "Trip {{tripId}} has been cancelled. Reason: {{reason}}. Contact us for questions.", variables: ["tripId", "reason"] },
  { id: "invoice_due", name: "Invoice Due", template: "Invoice #{{invoiceId}} for {{amount}} is due on {{dueDate}}. Pay online or contact billing.", variables: ["invoiceId", "amount", "dueDate"] },
  { id: "payment_received", name: "Payment Received", template: "Payment of {{amount}} received for invoice #{{invoiceId}}. Thank you!", variables: ["invoiceId", "amount"] },
];

const smsTemplateStore = new Map<string, typeof defaultSmsTemplates>();

function getCompanyTemplates(companyKey: string) {
  let templates = smsTemplateStore.get(companyKey);
  if (!templates) {
    templates = JSON.parse(JSON.stringify(defaultSmsTemplates));
    smsTemplateStore.set(companyKey, templates!);
  }
  return templates!;
}

router.get(
  "/api/admin/sms-templates",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyKey = String(req.user!.companyId || "global");
      const templates = getCompanyTemplates(companyKey);
      res.json({ templates });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.patch(
  "/api/admin/sms-templates/:templateId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyKey = String(req.user!.companyId || "global");
      const templates = getCompanyTemplates(companyKey);
      const { templateId } = req.params;
      const { template: newText } = req.body;

      const tpl = templates.find((t) => t.id === templateId);
      if (!tpl) {
        return res.status(404).json({ message: "Template not found" });
      }
      if (typeof newText !== "string" || newText.trim().length === 0) {
        return res.status(400).json({ message: "template text is required" });
      }
      tpl.template = newText.trim();
      res.json({ template: tpl });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/sms-templates/:templateId/test",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyKey = String(req.user!.companyId || "global");
      const templates = getCompanyTemplates(companyKey);
      const { templateId } = req.params;
      const { phoneNumber } = req.body;

      const tpl = templates.find((t) => t.id === templateId);
      if (!tpl) {
        return res.status(404).json({ message: "Template not found" });
      }
      if (!phoneNumber) {
        return res.status(400).json({ message: "phoneNumber is required" });
      }
      // In production, send via Twilio. For now, simulate.
      console.log(`[SMS_TEST] To: ${phoneNumber}, Template: ${tpl.name}, Text: ${tpl.template}`);
      res.json({ sent: true, to: phoneNumber, preview: tpl.template });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── Invoice Write-Off ───────────────────────────────────────────────────────

router.patch(
  "/api/invoices/:id/write-off",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const { reason } = req.body;
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ message: "Write-off reason is required" });
      }

      const [inv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

      if (!inv) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Update to a 'notes' field indicating write-off since schema doesn't have a dedicated field
      const writeOffNote = `[WRITTEN OFF] ${new Date().toISOString()} by user #${req.user!.id}: ${reason}`;
      const existingNotes = inv.notes || "";
      await db
        .update(invoices)
        .set({
          notes: existingNotes ? `${existingNotes}\n${writeOffNote}` : writeOffNote,
          status: "paid" as const, // Mark as resolved
        })
        .where(eq(invoices.id, invoiceId));

      res.json({ success: true, invoiceId, reason, writtenOffAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── Aged AR Report ──────────────────────────────────────────────────────────

router.get(
  "/api/billing/aged-ar",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const now = new Date();

      // Get all unpaid invoices
      const unpaidInvoices = await db
        .select({
          id: invoices.id,
          clinicId: invoices.clinicId,
          amount: invoices.amount,
          createdAt: invoices.createdAt,
          status: invoices.status,
          patientName: invoices.patientName,
          serviceDate: invoices.serviceDate,
        })
        .from(invoices)
        .where(eq(invoices.status, "pending"));

      const buckets = {
        "0-30": { totalCents: 0, count: 0, invoices: [] as any[] },
        "31-60": { totalCents: 0, count: 0, invoices: [] as any[] },
        "61-90": { totalCents: 0, count: 0, invoices: [] as any[] },
        "90+": { totalCents: 0, count: 0, invoices: [] as any[] },
      };

      for (const inv of unpaidInvoices) {
        const ageMs = now.getTime() - new Date(inv.createdAt).getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        const amountCents = Math.round(parseFloat(String(inv.amount)) * 100);

        let bucket: keyof typeof buckets;
        if (ageDays <= 30) bucket = "0-30";
        else if (ageDays <= 60) bucket = "31-60";
        else if (ageDays <= 90) bucket = "61-90";
        else bucket = "90+";

        buckets[bucket].totalCents += amountCents;
        buckets[bucket].count += 1;
        if (buckets[bucket].invoices.length < 20) {
          buckets[bucket].invoices.push({
            id: inv.id,
            clinicId: inv.clinicId,
            amount: amountCents,
            ageDays,
            patientName: inv.patientName,
            serviceDate: inv.serviceDate,
          });
        }
      }

      const totalOutstanding = Object.values(buckets).reduce((sum, b) => sum + b.totalCents, 0);
      const totalCount = Object.values(buckets).reduce((sum, b) => sum + b.count, 0);

      res.json({ buckets, totalOutstanding, totalCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── Claim Status Dashboard ──────────────────────────────────────────────────

router.get(
  "/api/edi/claims/dashboard",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const allClaims = await db
        .select({
          status: ediClaims.status,
          cnt: sql<number>`count(*)::int`,
          totalAmount: sql<number>`coalesce(sum(${ediClaims.amountCents}), 0)::int`,
        })
        .from(ediClaims)
        .groupBy(ediClaims.status);

      const summary: Record<string, { count: number; totalAmountCents: number }> = {};
      for (const row of allClaims) {
        summary[row.status] = { count: row.cnt, totalAmountCents: row.totalAmount };
      }

      res.json({ summary });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/api/edi/claims/search",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { q, status, from, to } = req.query;
      const conditions = [];

      if (status && status !== "all") {
        conditions.push(eq(ediClaims.status, status as string));
      }
      if (from) {
        conditions.push(gte(ediClaims.createdAt, new Date(from as string)));
      }
      if (to) {
        conditions.push(lte(ediClaims.createdAt, new Date(to as string)));
      }
      if (q) {
        conditions.push(
          or(
            like(ediClaims.claimNumber, `%${q}%`),
          )!
        );
      }

      const claims = await db
        .select()
        .from(ediClaims)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(ediClaims.createdAt))
        .limit(100);

      res.json({ claims });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/api/edi/claims/:id/timeline",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const claimId = parseInt(req.params.id);
      const events = await db
        .select()
        .from(ediClaimEvents)
        .where(eq(ediClaimEvents.claimId, claimId))
        .orderBy(desc(ediClaimEvents.createdAt));

      const [claim] = await db
        .select()
        .from(ediClaims)
        .where(eq(ediClaims.id, claimId))
        .limit(1);

      res.json({ claim, events });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── Fleet Reports ───────────────────────────────────────────────────────────

router.get(
  "/api/fleet/reports",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { days = "30" } = req.query;
      const daysNum = parseInt(days as string) || 30;
      const since = new Date();
      since.setDate(since.getDate() - daysNum);

      // Get trip counts per driver
      const driverTrips = await db
        .select({
          driverId: trips.driverId,
          tripCount: sql<number>`count(*)::int`,
          completedCount: sql<number>`count(case when ${trips.status} = 'COMPLETED' then 1 end)::int`,
        })
        .from(trips)
        .where(gte(trips.createdAt, since))
        .groupBy(trips.driverId);

      // Get vehicle info
      const { vehicles } = await import("@shared/schema");
      const allVehicles = await db.select().from(vehicles);
      const activeVehicles = allVehicles.filter((v) => v.status === "ACTIVE");
      const maintenanceVehicles = allVehicles.filter((v) => v.status === "MAINTENANCE");
      const outOfServiceVehicles = allVehicles.filter((v) => v.status === "OUT_OF_SERVICE");

      // Calculate utilization
      const totalTrips = driverTrips.reduce((sum, d) => sum + d.tripCount, 0);
      const activeDriverCount = driverTrips.filter((d) => d.tripCount > 0).length;
      const avgTripsPerDriver = activeDriverCount > 0 ? totalTrips / activeDriverCount : 0;

      // Top drivers by trip count
      const topDrivers = driverTrips
        .filter((d) => d.driverId !== null)
        .sort((a, b) => b.tripCount - a.tripCount)
        .slice(0, 10);

      res.json({
        period: { days: daysNum, since: since.toISOString() },
        fleet: {
          totalVehicles: allVehicles.length,
          activeVehicles: activeVehicles.length,
          maintenanceVehicles: maintenanceVehicles.length,
          outOfServiceVehicles: outOfServiceVehicles.length,
          utilizationRate: allVehicles.length > 0
            ? Math.round((activeVehicles.length / allVehicles.length) * 100)
            : 0,
        },
        drivers: {
          activeDrivers: activeDriverCount,
          totalTrips,
          avgTripsPerDriver: Math.round(avgTripsPerDriver * 10) / 10,
          avgTripsPerDay: Math.round((totalTrips / daysNum) * 10) / 10,
          topDrivers: topDrivers.map((d) => ({
            driverId: d.driverId,
            tripCount: d.tripCount,
            completedCount: d.completedCount,
          })),
        },
        vehicleStatusBreakdown: [
          { status: "ACTIVE", count: activeVehicles.length },
          { status: "MAINTENANCE", count: maintenanceVehicles.length },
          { status: "OUT_OF_SERVICE", count: outOfServiceVehicles.length },
        ],
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── Bulk User Operations ────────────────────────────────────────────────────

router.post(
  "/api/admin/users/bulk-archive",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: "userIds array is required" });
      }

      let archived = 0;
      for (const userId of userIds) {
        await db
          .update(users)
          .set({ active: false, deletedAt: new Date(), deletedBy: req.user!.id })
          .where(eq(users.id, userId));
        archived++;
      }
      res.json({ archived, total: userIds.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/users/bulk-role",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userIds, role } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: "userIds array is required" });
      }
      if (!role) {
        return res.status(400).json({ message: "role is required" });
      }

      let updated = 0;
      for (const userId of userIds) {
        await db
          .update(users)
          .set({ role: role as any })
          .where(eq(users.id, userId));
        updated++;
      }
      res.json({ updated, total: userIds.length, role });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/users/bulk-activate",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: "userIds array is required" });
      }

      let activated = 0;
      for (const userId of userIds) {
        await db
          .update(users)
          .set({ active: true, deletedAt: null })
          .where(eq(users.id, userId));
        activated++;
      }
      res.json({ activated, total: userIds.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── In-App Notifications ────────────────────────────────────────────────────

// In-memory notification store (in production, use DB table)
const notificationsStore = new Map<number, Array<{
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  read: boolean;
  createdAt: string;
}>>();

function getUserNotifications(userId: number) {
  if (!notificationsStore.has(userId)) {
    // Seed with some sample notifications
    notificationsStore.set(userId, [
      {
        id: "n1",
        type: "trip_completed",
        title: "Trip Completed",
        message: "Trip #UCM-001 has been completed successfully.",
        link: "/trips",
        read: false,
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      },
      {
        id: "n2",
        type: "system_alert",
        title: "System Update",
        message: "Platform maintenance scheduled for tonight.",
        read: false,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      },
      {
        id: "n3",
        type: "invoice_due",
        title: "Invoice Due Soon",
        message: "Invoice #INV-042 is due in 3 days.",
        link: "/invoices",
        read: true,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      },
    ]);
  }
  return notificationsStore.get(userId)!;
}

router.get(
  "/api/notifications",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const notifications = getUserNotifications(userId);
      const unreadCount = notifications.filter((n) => !n.read).length;
      res.json({ notifications, unreadCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.patch(
  "/api/notifications/:id/read",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const notifications = getUserNotifications(userId);
      const notif = notifications.find((n) => n.id === req.params.id);
      if (notif) {
        notif.read = true;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/notifications/mark-all-read",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const notifications = getUserNotifications(userId);
      notifications.forEach((n) => (n.read = true));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── Payment Methods (Stripe proxy) ─────────────────────────────────────────

router.get(
  "/api/billing/payment-methods",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      // In production, fetch from Stripe using company's Stripe customer ID
      // For now, return placeholder data
      res.json({
        paymentMethods: [
          {
            id: "pm_placeholder_1",
            type: "card",
            brand: "visa",
            last4: "4242",
            expMonth: 12,
            expYear: 2027,
            isDefault: true,
          },
        ],
        hasStripeCustomer: false,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/billing/payment-methods/setup-intent",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      // In production: create Stripe SetupIntent
      res.json({
        clientSecret: null,
        message: "Stripe integration required. Configure STRIPE_SECRET_KEY to enable payment methods.",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/billing/payment-methods/:id/set-default",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      // In production: update default payment method in Stripe
      res.json({ success: true, defaultPaymentMethodId: id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.delete(
  "/api/billing/payment-methods/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      // In production: detach from Stripe
      res.json({ success: true, removedId: id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

export function registerAdminSettingsRoutes(app: Express) {
  app.use(router);
}
