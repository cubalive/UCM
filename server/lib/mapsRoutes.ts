import type { Express, Request, Response } from "express";
import { z } from "zod";
import { GOOGLE_MAPS_KEY } from "../../lib/mapsConfig";
import { geocodeAddress, placesAutocomplete, placeDetails, etaMinutes, buildRoute } from "./googleMaps";
import { checkRateLimit } from "./rateLimiter";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";

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
      ok: GOOGLE_MAPS_KEY.length > 0,
      mapsKeyLoaded: GOOGLE_MAPS_KEY.length > 0,
    });
  });

  app.post("/api/maps/geocode", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: Request, res: Response) => {
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

  app.post("/api/maps/places/autocomplete", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: Request, res: Response) => {
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

  app.post("/api/maps/places/details", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: Request, res: Response) => {
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
}
