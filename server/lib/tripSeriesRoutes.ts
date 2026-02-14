import type { Express } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, getUserCityIds, type AuthRequest } from "../auth";
import { generatePublicId } from "../public-id";
import { z } from "zod";

const VALID_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function patternToDays(pattern: string, customMask?: string): string[] {
  switch (pattern) {
    case "mwf": return ["Mon", "Wed", "Fri"];
    case "tths": return ["Tue", "Thu", "Sat"];
    case "daily": return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    case "custom": {
      if (!customMask) return [];
      const days = customMask.split(",").map(d => d.trim());
      return days.filter(d => VALID_DAYS.includes(d as any));
    }
    default: return [];
  }
}

function getLocalDateParts(date: Date, tz: string): { year: string; month: string; day: string; dow: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(date);
  const y = parts.find(p => p.type === "year")?.value || "2026";
  const m = parts.find(p => p.type === "month")?.value || "01";
  const d = parts.find(p => p.type === "day")?.value || "01";
  const wdShort = parts.find(p => p.type === "weekday")?.value || "Mon";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: y, month: m, day: d, dow: dowMap[wdShort] ?? 0 };
}

function generateDatesForSeries(
  startDate: string,
  endDate: string | null,
  occurrences: number | null,
  dayNums: number[],
  timezone: string
): string[] {
  const dates: string[] = [];
  const maxOcc = occurrences || 365;
  const limit = Math.min(maxOcc, 365);

  const cursor = new Date(startDate + "T12:00:00Z");
  const maxIterations = 366;
  let iterations = 0;

  while (dates.length < limit && iterations < maxIterations) {
    iterations++;
    const local = getLocalDateParts(cursor, timezone);
    const dateStr = `${local.year}-${local.month}-${local.day}`;

    if (endDate && dateStr > endDate) break;

    if (dayNums.includes(local.dow)) {
      dates.push(dateStr);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function checkCityAccess(req: AuthRequest, cityId: number | undefined): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "SUPER_ADMIN") return true;
  if (!cityId) return true;
  const allowed = await getUserCityIds(req.user.userId, req.user.role);
  return allowed.includes(cityId);
}

const createSeriesSchema = z.object({
  cityId: z.number(),
  clinicId: z.number().nullable().optional(),
  patientId: z.number(),
  pattern: z.enum(["mwf", "tths", "daily", "custom"]),
  daysMask: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  occurrences: z.number().nullable().optional(),
  pickupTime: z.string(),
  estimatedArrivalTime: z.string(),
  pickupAddress: z.string(),
  pickupStreet: z.string().nullable().optional(),
  pickupCity: z.string().nullable().optional(),
  pickupState: z.string().nullable().optional(),
  pickupZip: z.string().nullable().optional(),
  pickupPlaceId: z.string().nullable().optional(),
  pickupLat: z.number().nullable().optional(),
  pickupLng: z.number().nullable().optional(),
  dropoffAddress: z.string(),
  dropoffStreet: z.string().nullable().optional(),
  dropoffCity: z.string().nullable().optional(),
  dropoffState: z.string().nullable().optional(),
  dropoffZip: z.string().nullable().optional(),
  dropoffPlaceId: z.string().nullable().optional(),
  dropoffLat: z.number().nullable().optional(),
  dropoffLng: z.number().nullable().optional(),
  driverId: z.number().nullable().optional(),
  vehicleId: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export function registerTripSeriesRoutes(app: Express) {

  app.get("/api/trip-series",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = req.query.cityId ? parseInt(String(req.query.cityId)) : undefined;
        if (cityId && !(await checkCityAccess(req, cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }
        const list = await storage.getTripSeriesList(cityId);
        res.json(list);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/trip-series/:id",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const series = await storage.getTripSeriesById(id);
        if (!series) return res.status(404).json({ message: "Series not found" });
        if (!(await checkCityAccess(req, series.cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }
        const trips = await storage.getTripsBySeriesId(id);
        res.json({ series, trips });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/trip-series",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const parsed = createSeriesSchema.safeParse(req.body);
        if (!parsed.success) {
          const firstIssue = parsed.error.issues[0];
          return res.status(400).json({ message: firstIssue?.message || "Invalid series data" });
        }
        const data = parsed.data;

        if (!(await checkCityAccess(req, data.cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }

        if (!data.endDate && !data.occurrences) {
          return res.status(400).json({ message: "Either end date or number of occurrences is required" });
        }

        if (data.endDate && data.endDate <= data.startDate) {
          return res.status(400).json({ message: "End date must be after start date" });
        }

        if (data.occurrences != null && data.occurrences < 1) {
          return res.status(400).json({ message: "Number of occurrences must be at least 1" });
        }

        if (data.pickupTime >= data.estimatedArrivalTime) {
          return res.status(400).json({ message: "Pickup time must be before estimated arrival time" });
        }

        const days = patternToDays(data.pattern, data.daysMask);
        if (days.length === 0) {
          return res.status(400).json({ message: "No valid days selected for recurring schedule" });
        }

        const city = await storage.getCity(data.cityId);
        const timezone = city?.timezone || "America/New_York";

        const dayNums = days.map(d => DAY_MAP[d]).filter(n => n !== undefined);
        const dates = generateDatesForSeries(
          data.startDate,
          data.endDate || null,
          data.occurrences || null,
          dayNums,
          timezone
        );

        if (dates.length === 0) {
          return res.status(400).json({ message: "No trip dates could be generated from the schedule" });
        }

        const series = await storage.createTripSeries({
          cityId: data.cityId,
          clinicId: data.clinicId ?? null,
          patientId: data.patientId,
          pattern: data.pattern,
          daysMask: data.daysMask,
          startDate: data.startDate,
          endDate: data.endDate ?? null,
          occurrences: data.occurrences ?? null,
          pickupTime: data.pickupTime,
          estimatedArrivalTime: data.estimatedArrivalTime,
          pickupAddress: data.pickupAddress,
          pickupStreet: data.pickupStreet ?? null,
          pickupCity: data.pickupCity ?? null,
          pickupState: data.pickupState ?? null,
          pickupZip: data.pickupZip ?? null,
          pickupPlaceId: data.pickupPlaceId ?? null,
          pickupLat: data.pickupLat ?? null,
          pickupLng: data.pickupLng ?? null,
          dropoffAddress: data.dropoffAddress,
          dropoffStreet: data.dropoffStreet ?? null,
          dropoffCity: data.dropoffCity ?? null,
          dropoffState: data.dropoffState ?? null,
          dropoffZip: data.dropoffZip ?? null,
          dropoffPlaceId: data.dropoffPlaceId ?? null,
          dropoffLat: data.dropoffLat ?? null,
          dropoffLng: data.dropoffLng ?? null,
          createdBy: req.user!.userId,
        });

        const user = await storage.getUser(req.user!.userId);
        const isClinic = user?.role === "VIEWER" && user.clinicId != null;

        const createdTrips = [];
        for (const date of dates) {
          const publicId = await generatePublicId();
          const approvalFields: Record<string, any> = {};
          if (isClinic) {
            approvalFields.approvalStatus = "pending";
          } else {
            approvalFields.approvalStatus = "approved";
            approvalFields.approvedAt = new Date();
            approvalFields.approvedBy = req.user!.userId;
          }

          const trip = await storage.createTrip({
            publicId,
            cityId: data.cityId,
            clinicId: data.clinicId ?? null,
            patientId: data.patientId,
            scheduledDate: date,
            scheduledTime: data.pickupTime,
            pickupTime: data.pickupTime,
            estimatedArrivalTime: data.estimatedArrivalTime,
            pickupAddress: data.pickupAddress,
            pickupStreet: data.pickupStreet ?? null,
            pickupCity: data.pickupCity ?? null,
            pickupState: data.pickupState ?? null,
            pickupZip: data.pickupZip ?? null,
            pickupPlaceId: data.pickupPlaceId ?? null,
            pickupLat: data.pickupLat ?? null,
            pickupLng: data.pickupLng ?? null,
            dropoffAddress: data.dropoffAddress,
            dropoffStreet: data.dropoffStreet ?? null,
            dropoffCity: data.dropoffCity ?? null,
            dropoffState: data.dropoffState ?? null,
            dropoffZip: data.dropoffZip ?? null,
            dropoffPlaceId: data.dropoffPlaceId ?? null,
            dropoffLat: data.dropoffLat ?? null,
            dropoffLng: data.dropoffLng ?? null,
            tripType: "recurring",
            recurringDays: days,
            driverId: data.driverId ?? null,
            vehicleId: data.vehicleId ?? null,
            notes: data.notes ?? null,
            tripSeriesId: series.id,
            ...approvalFields,
          } as any);
          createdTrips.push(trip);
        }

        if (createdTrips.length > 0) {
          import("./dispatchAutoSms").then(({ autoNotifyPatient }) => {
            autoNotifyPatient(createdTrips[0].id, "scheduled");
          }).catch((err) => {
            console.error(`[SMS-AUTO] Failed to send scheduled SMS for series trip:`, err.message);
          });
        }

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "CREATE",
          entity: "trip_series",
          entityId: series.id,
          details: `Created trip series with ${createdTrips.length} trips (${data.pattern} pattern)`,
          cityId: data.cityId,
        });

        res.json({ series, trips: createdTrips, count: createdTrips.length });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.patch("/api/trip-series/:id/deactivate",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const series = await storage.getTripSeriesById(id);
        if (!series) return res.status(404).json({ message: "Series not found" });
        if (!(await checkCityAccess(req, series.cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }

        const updated = await storage.updateTripSeries(id, { active: false } as any);

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "UPDATE",
          entity: "trip_series",
          entityId: id,
          details: "Deactivated trip series",
          cityId: series.cityId,
        });

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.patch("/api/trip-series/:id/activate",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const series = await storage.getTripSeriesById(id);
        if (!series) return res.status(404).json({ message: "Series not found" });
        if (!(await checkCityAccess(req, series.cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }

        const updated = await storage.updateTripSeries(id, { active: true } as any);
        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}
