import type { Express, Request, Response } from "express";
import { z } from "zod";
import { GOOGLE_MAPS_SERVER_KEY, GOOGLE_MAPS_BROWSER_KEY } from "../../lib/mapsConfig";
const GOOGLE_MAPS_KEY = GOOGLE_MAPS_SERVER_KEY;
import { geocodeAddress, placesAutocomplete, placeDetails, etaMinutes, buildRoute, googleDistanceMatrix } from "./googleMaps";
import { checkRateLimit } from "./rateLimiter";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import { ONLINE_CUTOFF_MS } from "./driverClassification";
import { db } from "../db";
import { drivers } from "@shared/schema";
import { inArray, eq, and } from "drizzle-orm";

function getRateLimitKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.ip || "unknown";
  return `maps:${ip}`;
}

function rateLimitMiddleware(req: Request, res: Response): boolean {
  const { allowed, remaining, retryAfterMs } = checkRateLimit(getRateLimitKey(req), 60, 60);
  res.setHeader("X-RateLimit-Remaining", remaining);
  if (!allowed) {
    res.status(429).json({
      ok: false,
      error: "Rate limit exceeded. Try again later.",
      retryAfterMs,
    });
    return false;
  }
  return true;
}

const geocodeSchema = z.object({
  address: z.string().min(3, "Address must be at least 3 characters"),
});

const autocompleteSchema = z.object({
  input: z.string().min(2, "Input must be at least 2 characters"),
});

const placeDetailsSchema = z.object({
  placeId: z.string().min(1, "placeId is required"),
});

const latLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const locationSchema = z.union([z.string().min(3), latLngSchema]);

const etaSchema = z.object({
  origin: locationSchema,
  destination: locationSchema,
});

const routeSchema = z.object({
  origin: locationSchema,
  destination: locationSchema,
  waypoints: z.array(locationSchema).optional(),
});

export function registerMapsRoutes(app: Express): void {
  app.get("/api/maps/health", (_req, res) => {
    res.json({
      ok: GOOGLE_MAPS_BROWSER_KEY.length > 0 || GOOGLE_MAPS_KEY.length > 0,
      mapsKeyLoaded: GOOGLE_MAPS_BROWSER_KEY.length > 0 || GOOGLE_MAPS_KEY.length > 0,
    });
  });

  app.get("/api/google/health", (_req, res) => {
    res.json({
      ok: true,
      hasBrowserKey: GOOGLE_MAPS_BROWSER_KEY.length > 0,
      hasServerKey: GOOGLE_MAPS_KEY.length > 0,
    });
  });

  app.get("/api/maps/client-key", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "VIEWER", "DRIVER", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "COMPANY_ADMIN"), (_req: Request, res: Response) => {
    const clientKey = GOOGLE_MAPS_BROWSER_KEY;
    if (!clientKey) {
      return res.status(503).json({ key: null, message: "Google Maps browser API key not configured. Set GOOGLE_MAPS_BROWSER_KEY." });
    }
    res.json({ key: clientKey });
  });

  app.post("/api/maps/geocode", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "COMPANY_ADMIN", "SUPER_ADMIN"), async (req: Request, res: Response) => {
    if (!rateLimitMiddleware(req, res)) return;

    const parsed = geocodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues[0].message });
    }

    try {
      const result = await geocodeAddress(parsed.data.address);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/maps/places/autocomplete", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "COMPANY_ADMIN", "SUPER_ADMIN"), async (req: Request, res: Response) => {
    if (!rateLimitMiddleware(req, res)) return;

    const parsed = autocompleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues[0].message });
    }

    try {
      const results = await placesAutocomplete(parsed.data.input);
      res.json({ ok: true, results });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/maps/places/details", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "COMPANY_ADMIN", "SUPER_ADMIN"), async (req: Request, res: Response) => {
    if (!rateLimitMiddleware(req, res)) return;

    const parsed = placeDetailsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues[0].message });
    }

    try {
      const result = await placeDetails(parsed.data.placeId);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/maps/eta", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: Request, res: Response) => {
    if (!rateLimitMiddleware(req, res)) return;

    const parsed = etaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues[0].message });
    }

    try {
      const result = await etaMinutes(parsed.data.origin, parsed.data.destination);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/maps/route", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: Request, res: Response) => {
    if (!rateLimitMiddleware(req, res)) return;

    const parsed = routeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues[0].message });
    }

    try {
      const result = await buildRoute(
        parsed.data.origin,
        parsed.data.destination,
        parsed.data.waypoints
      );
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/eta", authMiddleware, async (req: Request, res: Response) => {
    if (!rateLimitMiddleware(req, res)) return;

    const originLat = parseFloat(req.query.originLat as string);
    const originLng = parseFloat(req.query.originLng as string);
    const destLat = parseFloat(req.query.destLat as string);
    const destLng = parseFloat(req.query.destLng as string);

    if ([originLat, originLng, destLat, destLng].some(isNaN)) {
      return res.status(400).json({ error: "originLat, originLng, destLat, destLng are required numbers" });
    }

    try {
      const result = await googleDistanceMatrix(
        { lat: originLat, lng: originLng },
        [{ lat: destLat, lng: destLng }]
      );

      const el = result.elements[0];
      let durationSec = el?.durationSeconds ?? -1;
      let distMeters = el?.distanceMeters ?? -1;

      if (!el || el.status !== "OK" || durationSec <= 0) {
        const R = 6371000;
        const dLat = (destLat - originLat) * Math.PI / 180;
        const dLng = (destLng - originLng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(originLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        distMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const miles = distMeters / 1609.344;
        durationSec = Math.round((miles / 25) * 3600);
      }

      res.json({
        eta_minutes: Math.max(1, Math.round(durationSec / 60)),
        distance_miles: Math.round((distMeters / 1609.344) * 10) / 10,
      });
    } catch (e: any) {
      console.error(`[ETA] Error: ${e.message}`);
      res.status(502).json({ error: e.message });
    }
  });

  const nearestDriverSchema = z.object({
    pickupLat: z.number(),
    pickupLng: z.number(),
    driverIds: z.array(z.number()).min(1).max(25),
  });

  app.post("/api/dispatch/nearest-driver", authMiddleware, requirePermission("dispatch", "write"), async (req: Request, res: Response) => {
    if (!rateLimitMiddleware(req, res)) return;

    const parsed = nearestDriverSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { pickupLat, pickupLng, driverIds } = parsed.data;

    try {
      const driverRows = await db.select({
        id: drivers.id,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        lastLat: drivers.lastLat,
        lastLng: drivers.lastLng,
        lastSeenAt: drivers.lastSeenAt,
        dispatchStatus: drivers.dispatchStatus,
      }).from(drivers).where(inArray(drivers.id, driverIds));

      const now = Date.now();
      const onlineDrivers = driverRows.filter(d => {
        if (d.dispatchStatus !== "available") return false;
        if (d.lastLat == null || d.lastLng == null) return false;
        if (!d.lastSeenAt) return false;
        const elapsed = now - new Date(d.lastSeenAt as any).getTime();
        return elapsed <= ONLINE_CUTOFF_MS;
      });

      if (onlineDrivers.length === 0) {
        return res.json({ drivers: [] });
      }

      const destinations = onlineDrivers.map(d => ({ lat: d.lastLat!, lng: d.lastLng! }));
      const dmResult = await googleDistanceMatrix(
        { lat: pickupLat, lng: pickupLng },
        destinations
      );

      const ranked = onlineDrivers.map((d, i) => {
        const el = dmResult.elements[i];
        return {
          driver_id: d.id,
          driver_name: `${d.firstName} ${d.lastName}`,
          eta_minutes: el && el.status === "OK" ? Math.round(el.durationSeconds / 60) : null,
          distance_miles: el && el.status === "OK" ? Math.round((el.distanceMeters / 1609.344) * 10) / 10 : null,
        };
      });

      ranked.sort((a, b) => {
        if (a.eta_minutes == null) return 1;
        if (b.eta_minutes == null) return -1;
        return a.eta_minutes - b.eta_minutes;
      });

      res.json({ drivers: ranked });
    } catch (e: any) {
      console.error(`[NearestDriver] Error: ${e.message}`);
      res.status(502).json({ error: e.message });
    }
  });
}
