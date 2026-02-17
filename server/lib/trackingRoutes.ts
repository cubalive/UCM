import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { authMiddleware, requireRole, getCompanyIdFromAuth, checkCompanyOwnership, type AuthRequest } from "../auth";
import { tripLockedGuard } from "./tripLockGuard";
import { etaMinutes, buildStaticMapUrls } from "./googleMaps";
import { GOOGLE_MAPS_SERVER_KEY, GOOGLE_MAPS_BROWSER_KEY } from "../../lib/mapsConfig";
const GOOGLE_MAPS_KEY = GOOGLE_MAPS_SERVER_KEY;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const mapsKeyRateLimit = new Map<string, { count: number; resetAt: number }>();
const MAPS_KEY_RATE_LIMIT = 30;
const MAPS_KEY_RATE_WINDOW = 60_000;

export function registerTrackingRoutes(app: Express) {
  app.get("/api/public/maps/key", (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    const now = Date.now();
    const entry = mapsKeyRateLimit.get(ip);
    if (entry && now < entry.resetAt) {
      entry.count++;
      if (entry.count > MAPS_KEY_RATE_LIMIT) {
        return res.status(429).json({ key: null, message: "Rate limit exceeded" });
      }
    } else {
      mapsKeyRateLimit.set(ip, { count: 1, resetAt: now + MAPS_KEY_RATE_WINDOW });
    }

    if (GOOGLE_MAPS_BROWSER_KEY) {
      res.json({ key: GOOGLE_MAPS_BROWSER_KEY });
    } else {
      res.json({ key: null });
    }
  });

  app.get(
    "/api/trips/:id/eta-to-pickup",
    authMiddleware,
    requireRole("SUPER_ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.id as string);
        if (isNaN(tripId)) return res.status(400).json({ ok: false, message: "Invalid trip ID" });

        const trip = await storage.getTrip(tripId);
        if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });
        const companyId = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(trip, companyId)) return res.status(403).json({ ok: false, message: "Access denied" });

        if (!trip.driverId) {
          return res.json({ ok: false, message: "No driver assigned" });
        }

        const driver = await storage.getDriver(trip.driverId);
        if (!driver || !driver.lastLat || !driver.lastLng) {
          return res.json({ ok: false, message: "Driver location unavailable" });
        }

        if (!trip.pickupLat || !trip.pickupLng) {
          return res.json({ ok: false, message: "Pickup coordinates unavailable" });
        }

        const { getGpsStaleInfo } = await import("./driverLocationIngest");
        const gpsInfo = getGpsStaleInfo(trip.driverId!);

        if (gpsInfo.hide_eta) {
          return res.json({
            ok: true,
            eta_minutes: null,
            distance_text: null,
            updated_at: null,
            source: "hidden",
            gps_stale: gpsInfo.gps_stale,
            stale_reason: gpsInfo.stale_reason,
          });
        }

        try {
          const { getThrottledEta } = await import("./etaThrottle");
          const eta = await getThrottledEta(trip.driverId!, { lat: trip.pickupLat, lng: trip.pickupLng }, trip.id);

          if (eta) {
            await storage.updateTrip(trip.id, {
              lastEtaMinutes: eta.minutes,
              distanceMiles: eta.distanceMiles.toString(),
              lastEtaUpdatedAt: new Date(),
            } as any);

            return res.json({
              ok: true,
              eta_minutes: eta.minutes,
              distance_text: `${eta.distanceMiles} mi`,
              updated_at: new Date().toISOString(),
              source: eta.source,
              gps_stale: gpsInfo.gps_stale,
              stale_reason: gpsInfo.stale_reason || undefined,
            });
          }

          if (trip.lastEtaMinutes != null) {
            return res.json({
              ok: true,
              eta_minutes: trip.lastEtaMinutes,
              distance_text: trip.distanceMiles ? `${trip.distanceMiles} mi` : null,
              updated_at: trip.lastEtaUpdatedAt?.toISOString() || null,
              source: "cached",
              gps_stale: gpsInfo.gps_stale,
            });
          }
          return res.json({ ok: false, message: "Could not calculate ETA", gps_stale: gpsInfo.gps_stale });
        } catch (etaErr: any) {
          if (trip.lastEtaMinutes != null) {
            return res.json({
              ok: true,
              eta_minutes: trip.lastEtaMinutes,
              distance_text: trip.distanceMiles ? `${trip.distanceMiles} mi` : null,
              updated_at: trip.lastEtaUpdatedAt?.toISOString() || null,
              source: "cached",
              gps_stale: gpsInfo.gps_stale,
            });
          }
          return res.json({ ok: false, message: "Could not calculate ETA", gps_stale: gpsInfo.gps_stale });
        }
      } catch (err: any) {
        res.status(500).json({ ok: false, message: err.message });
      }
    }
  );

  async function ensureStaticMap(trip: any): Promise<{ thumbUrl: string | null; fullUrl: string | null }> {
    if (trip.staticMapThumbUrl && trip.staticMapFullUrl) {
      return { thumbUrl: trip.staticMapThumbUrl, fullUrl: trip.staticMapFullUrl };
    }
    if (!trip.pickupLat || !trip.pickupLng || !trip.dropoffLat || !trip.dropoffLng) {
      return { thumbUrl: null, fullUrl: null };
    }
    const urls = buildStaticMapUrls(trip.pickupLat, trip.pickupLng, trip.dropoffLat, trip.dropoffLng);
    if (!urls) return { thumbUrl: null, fullUrl: null };

    try {
      await storage.updateTrip(trip.id, {
        staticMapThumbUrl: urls.thumbUrl,
        staticMapFullUrl: urls.fullUrl,
        staticMapGeneratedAt: new Date(),
      } as any);
    } catch {}

    return { thumbUrl: urls.thumbUrl, fullUrl: urls.fullUrl };
  }

  app.get(
    "/api/trips/:id/static-map",
    authMiddleware,
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.id as string);
        if (isNaN(tripId)) return res.status(400).json({ ok: false, message: "Invalid trip ID" });

        const trip = await storage.getTrip(tripId);
        if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });
        const cId = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(trip, cId)) return res.status(403).json({ ok: false, message: "Access denied" });

        const { thumbUrl, fullUrl } = await ensureStaticMap(trip);

        res.json({
          ok: true,
          thumb_url: thumbUrl ? `/api/trips/${tripId}/static-map/thumb` : null,
          full_url: fullUrl ? `/api/trips/${tripId}/static-map/full` : null,
        });
      } catch (err: any) {
        res.status(500).json({ ok: false, message: err.message });
      }
    }
  );

  app.get(
    "/api/trips/:id/static-map/:size",
    (req: AuthRequest, res, next) => {
      const qToken = req.query.t as string;
      if (qToken) {
        try {
          const { verifyToken } = require("../auth");
          req.user = verifyToken(qToken);
          return next();
        } catch {
          return res.status(401).json({ message: "Invalid token" });
        }
      }
      return authMiddleware(req, res, next);
    },
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.id as string);
        const size = req.params.size as string;
        if (isNaN(tripId) || (size !== "thumb" && size !== "full")) {
          return res.status(400).json({ message: "Invalid request" });
        }

        const trip = await storage.getTrip(tripId);
        if (!trip) return res.status(404).json({ message: "Trip not found" });

        if (req.user) {
          const cId = getCompanyIdFromAuth(req);
          if (!checkCompanyOwnership(trip, cId)) return res.status(403).json({ message: "Access denied" });

          const user = await storage.getUser(req.user.userId);
          if (user) {
            const role = user.role;
            if (role !== "SUPER_ADMIN" && role !== "ADMIN" && role !== "DISPATCH" && role !== "COMPANY_ADMIN") {
              if ((role === "VIEWER" || role === "CLINIC_USER") && user.clinicId) {
                if (trip.clinicId !== user.clinicId) {
                  return res.status(403).json({ message: "Access denied" });
                }
              } else if (role === "DRIVER") {
                const drivers = await storage.getDrivers();
                const driverRecord = drivers.find(d => d.userId === user.id);
                if (!driverRecord || trip.driverId !== driverRecord.id) {
                  return res.status(403).json({ message: "Access denied" });
                }
              } else {
                return res.status(403).json({ message: "Access denied" });
              }
            }
          }
        }

        const { thumbUrl, fullUrl } = await ensureStaticMap(trip);
        const targetUrl = size === "thumb" ? thumbUrl : fullUrl;

        if (!targetUrl) {
          return res.status(404).json({ message: "Static map not available" });
        }

        const imgRes = await fetch(targetUrl);
        if (!imgRes.ok) {
          return res.status(502).json({ message: "Failed to fetch map image" });
        }

        res.setHeader("Content-Type", imgRes.headers.get("content-type") || "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        res.send(buffer);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/public/trips/static-map/:token/:size", async (req, res) => {
    try {
      const tokenValue = req.params.token;
      const size = req.params.size;
      if (!tokenValue || tokenValue.length < 16 || (size !== "thumb" && size !== "full")) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const tokenRecord = await storage.getTokenByValue(tokenValue);
      if (!tokenRecord || tokenRecord.revoked || new Date() > tokenRecord.expiresAt) {
        return res.status(404).json({ message: "Not found" });
      }

      const trip = await storage.getTrip(tokenRecord.tripId);
      if (!trip) return res.status(404).json({ message: "Not found" });

      const { thumbUrl, fullUrl } = await ensureStaticMap(trip);
      const targetUrl = size === "thumb" ? thumbUrl : fullUrl;

      if (!targetUrl) {
        return res.status(404).json({ message: "Map not available" });
      }

      const imgRes = await fetch(targetUrl);
      if (!imgRes.ok) {
        return res.status(502).json({ message: "Failed to fetch map image" });
      }

      res.setHeader("Content-Type", imgRes.headers.get("content-type") || "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      res.send(buffer);
    } catch {
      res.status(500).json({ message: "Internal error" });
    }
  });

  app.post(
    "/api/trips/:id/share-token",
    authMiddleware,
    requireRole("SUPER_ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.id as string);
        if (isNaN(tripId)) return res.status(400).json({ ok: false, message: "Invalid trip ID" });

        const trip = await storage.getTrip(tripId);
        if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });
        if (tripLockedGuard(trip, req, res)) return;

        await storage.revokeTokensForTrip(tripId);

        const token = generateToken();
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

        const shareToken = await storage.createTripShareToken({
          tripId,
          token,
          expiresAt,
          revoked: false,
        });

        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const url = `${baseUrl}/t/${token}`;

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "SHARE_TOKEN_CREATE",
          entity: "trip",
          entityId: tripId,
          details: `Tracking link created, expires ${expiresAt.toISOString()}`,
          cityId: trip.cityId,
        });

        res.json({
          ok: true,
          url,
          token: shareToken.token,
          expires_at: shareToken.expiresAt.toISOString(),
        });
      } catch (err: any) {
        res.status(500).json({ ok: false, message: err.message });
      }
    }
  );

  app.post(
    "/api/trips/:id/share-token/revoke",
    authMiddleware,
    requireRole("SUPER_ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.id as string);
        if (isNaN(tripId)) return res.status(400).json({ ok: false, message: "Invalid trip ID" });

        await storage.revokeTokensForTrip(tripId);

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "SHARE_TOKEN_REVOKE",
          entity: "trip",
          entityId: tripId,
          details: `All tracking links revoked`,
          cityId: null,
        });

        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ ok: false, message: err.message });
      }
    }
  );

  app.get("/api/public/trips/track/:token", async (req, res) => {
    try {
      try { const { incrDirectionsMetric } = await import("./googleMaps"); incrDirectionsMetric("trackingRequests"); } catch {}
      const tokenValue = req.params.token;
      if (!tokenValue || tokenValue.length < 16) {
        return res.status(400).json({ ok: false, message: "Invalid token" });
      }

      const tokenRecord = await storage.getTokenByValue(tokenValue);
      if (!tokenRecord) {
        return res.status(404).json({ ok: false, message: "Link not found or expired" });
      }
      if (tokenRecord.revoked) {
        return res.status(410).json({ ok: false, message: "This tracking link has been revoked" });
      }
      if (new Date() > tokenRecord.expiresAt) {
        return res.status(410).json({ ok: false, message: "This tracking link has expired" });
      }

      const trip = await storage.getTrip(tokenRecord.tripId);
      if (!trip) {
        return res.status(404).json({ ok: false, message: "Trip not found" });
      }

      let driverData: { name: string; lat: number | null; lng: number | null; updated_at: string | null } | null = null;
      let etaData: { minutes: number; distance_text: string | null; updated_at: string | null } | null = null;

      if (trip.driverId) {
        const driver = await storage.getDriver(trip.driverId);
        if (driver) {
          let driverLat = driver.lastLat;
          let driverLng = driver.lastLng;
          try {
            const { getDriverLocationFromCache } = await import("./driverLocationIngest");
            const cached = getDriverLocationFromCache(driver.id);
            if (cached) { driverLat = cached.lat; driverLng = cached.lng; }
          } catch {}

          driverData = {
            name: `${driver.firstName} ${driver.lastName}`,
            lat: driverLat,
            lng: driverLng,
            updated_at: driver.lastSeenAt ? driver.lastSeenAt.toISOString() : null,
          };

          let gpsStale: any = null;
          try {
            const { getGpsStaleInfo } = await import("./driverLocationIngest");
            gpsStale = getGpsStaleInfo(driver.id);
          } catch {}

          if (gpsStale?.hide_eta) {
            etaData = null;
          } else if (trip.lastEtaMinutes != null) {
            etaData = {
              minutes: trip.lastEtaMinutes,
              distance_text: trip.distanceMiles ? `${trip.distanceMiles} mi` : null,
              updated_at: trip.lastEtaUpdatedAt ? trip.lastEtaUpdatedAt.toISOString() : null,
            };
          } else if (trip.pickupLat && trip.pickupLng) {
            try {
              const { getThrottledEta } = await import("./etaThrottle");
              const eta = await getThrottledEta(trip.driverId!, { lat: trip.pickupLat, lng: trip.pickupLng }, trip.id);
              if (eta) {
                etaData = {
                  minutes: eta.minutes,
                  distance_text: `${eta.distanceMiles} mi`,
                  updated_at: new Date().toISOString(),
                };
              }
            } catch {}
          }

          if (driverData && gpsStale) {
            (driverData as any).gps_stale = gpsStale.gps_stale;
            if (gpsStale.stale_reason) (driverData as any).stale_reason = gpsStale.stale_reason;
          }
        }
      }

      const pickupParts = [trip.pickupStreet, trip.pickupCity, trip.pickupState, trip.pickupZip].filter(Boolean);
      const pickupSummary = pickupParts.length > 0 ? pickupParts.join(", ") : trip.pickupAddress;

      res.json({
        ok: true,
        trip: {
          status: trip.status,
          pickup_time: trip.pickupTime,
          pickup_address: pickupSummary,
          pickup_lat: trip.pickupLat,
          pickup_lng: trip.pickupLng,
          scheduled_date: trip.scheduledDate,
        },
        driver: driverData,
        eta: etaData,
        route_polyline: trip.routePolyline || null,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: "Internal error" });
    }
  });

  app.get(
    "/api/trips/:id/live",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.id as string);
        if (isNaN(tripId)) return res.status(400).json({ ok: false, message: "Invalid trip ID" });

        const trip = await storage.getTrip(tripId);
        if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });

        const user = await storage.getUser(req.user!.userId);
        if (!user) return res.status(404).json({ ok: false, message: "User not found" });

        if (user.role === "CLINIC_USER") {
          if (!user.clinicId || trip.clinicId !== user.clinicId) {
            return res.status(403).json({ ok: false, message: "Access denied" });
          }
        }
        if (user.role === "COMPANY_ADMIN") {
          if (!user.companyId || !trip.companyId || trip.companyId !== user.companyId) {
            return res.status(403).json({ ok: false, message: "Access denied" });
          }
        }

        if (!trip.driverId) {
          return res.json({
            ok: true,
            driver_location: null,
            eta: null,
            message: "No driver assigned",
          });
        }

        const { getGpsStaleInfo, getDriverLocationFromCache } = await import("./driverLocationIngest");
        const { getThrottledEta } = await import("./etaThrottle");

        const driverLoc = getDriverLocationFromCache(trip.driverId);
        const gpsInfo = getGpsStaleInfo(trip.driverId);

        let driverLocationData: any = null;
        if (driverLoc) {
          const ageMs = Date.now() - driverLoc.timestamp;
          driverLocationData = {
            lat: driverLoc.lat,
            lng: driverLoc.lng,
            heading: driverLoc.heading ?? null,
            speed: driverLoc.speed ?? null,
            last_update_seconds_ago: Math.round(ageMs / 1000),
            gps_stale: gpsInfo.gps_stale,
            stale_reason: gpsInfo.stale_reason || null,
          };
        }

        let etaData: any = null;
        if (!gpsInfo.hide_eta) {
          const PICKUP_PHASES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP"];
          const DROPOFF_PHASES = ["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];

          let destination: { lat: number; lng: number } | null = null;
          let etaLabel = "pickup";

          if (PICKUP_PHASES.includes(trip.status) && trip.pickupLat && trip.pickupLng) {
            destination = { lat: parseFloat(trip.pickupLat as any), lng: parseFloat(trip.pickupLng as any) };
            etaLabel = "pickup";
          } else if (DROPOFF_PHASES.includes(trip.status) && trip.dropoffLat && trip.dropoffLng) {
            destination = { lat: parseFloat(trip.dropoffLat as any), lng: parseFloat(trip.dropoffLng as any) };
            etaLabel = "dropoff";
          }

          if (destination) {
            try {
              const eta = await getThrottledEta(trip.driverId!, destination, trip.id);
              if (eta) {
                etaData = {
                  minutes: eta.minutes,
                  distance_miles: eta.distanceMiles,
                  destination: etaLabel,
                  source: eta.source,
                  computed_at: new Date(eta.computedAt).toISOString(),
                };
              }
            } catch {}
          }

          if (!etaData && trip.lastEtaMinutes != null) {
            etaData = {
              minutes: trip.lastEtaMinutes,
              distance_miles: trip.distanceMiles ? parseFloat(trip.distanceMiles as any) : null,
              destination: "cached",
              source: "cached",
              computed_at: trip.lastEtaUpdatedAt?.toISOString() || null,
            };
          }
        }

        const driver = await storage.getDriver(trip.driverId);
        const driverName = driver ? `${driver.firstName} ${driver.lastName}` : null;

        res.json({
          ok: true,
          driver_location: driverLocationData,
          driver_name: driverName,
          eta: etaData,
          trip_status: trip.status,
          gps_stale: gpsInfo.gps_stale,
          hide_eta: gpsInfo.hide_eta,
        });
      } catch (err: any) {
        res.status(500).json({ ok: false, message: err.message });
      }
    }
  );
}
