import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { tripLockedGuard } from "./tripLockGuard";
import { etaMinutes, buildStaticMapUrls } from "./googleMaps";
import { GOOGLE_MAPS_SERVER_KEY, GOOGLE_MAPS_BROWSER_KEY } from "../../lib/mapsConfig";
const GOOGLE_MAPS_KEY = GOOGLE_MAPS_SERVER_KEY;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function registerTrackingRoutes(app: Express) {
  app.get("/api/public/maps/key", (_req, res) => {
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

        if (!GOOGLE_MAPS_KEY) {
          if (trip.lastEtaMinutes != null) {
            return res.json({
              ok: true,
              eta_minutes: trip.lastEtaMinutes,
              distance_text: trip.distanceMiles ? `${trip.distanceMiles} mi` : null,
              updated_at: trip.lastEtaUpdatedAt?.toISOString() || new Date().toISOString(),
              source: "cached",
            });
          }
          return res.json({ ok: false, message: "Maps API not configured" });
        }

        try {
          const eta = await etaMinutes(
            { lat: driver.lastLat, lng: driver.lastLng },
            { lat: trip.pickupLat, lng: trip.pickupLng }
          );

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
            source: "live",
          });
        } catch (etaErr: any) {
          if (trip.lastEtaMinutes != null) {
            return res.json({
              ok: true,
              eta_minutes: trip.lastEtaMinutes,
              distance_text: trip.distanceMiles ? `${trip.distanceMiles} mi` : null,
              updated_at: trip.lastEtaUpdatedAt?.toISOString() || null,
              source: "cached",
            });
          }
          return res.json({ ok: false, message: "Could not calculate ETA" });
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
          const user = await storage.getUser(req.user.userId);
          if (user) {
            const role = user.role;
            if (role !== "SUPER_ADMIN" && role !== "ADMIN" && role !== "DISPATCH") {
              if (role === "VIEWER" && user.clinicId) {
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
          driverData = {
            name: `${driver.firstName} ${driver.lastName}`,
            lat: driver.lastLat,
            lng: driver.lastLng,
            updated_at: driver.lastSeenAt ? driver.lastSeenAt.toISOString() : null,
          };

          if (trip.lastEtaMinutes != null) {
            etaData = {
              minutes: trip.lastEtaMinutes,
              distance_text: trip.distanceMiles ? `${trip.distanceMiles} mi` : null,
              updated_at: trip.lastEtaUpdatedAt ? trip.lastEtaUpdatedAt.toISOString() : null,
            };
          } else if (
            GOOGLE_MAPS_KEY &&
            driver.lastLat && driver.lastLng &&
            trip.pickupLat && trip.pickupLng
          ) {
            try {
              const eta = await etaMinutes(
                { lat: driver.lastLat, lng: driver.lastLng },
                { lat: trip.pickupLat, lng: trip.pickupLng }
              );
              etaData = {
                minutes: eta.minutes,
                distance_text: `${eta.distanceMiles} mi`,
                updated_at: new Date().toISOString(),
              };
            } catch {}
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
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: "Internal error" });
    }
  });
}
