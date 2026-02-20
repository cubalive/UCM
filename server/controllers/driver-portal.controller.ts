import type { Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, getCompanyIdFromAuth, invalidateRevocationCache, clearAuthCookie, type AuthRequest } from "../auth";
import { drivers, users, trips, tripMessages, citySettings, driverTripAlerts, driverOffers, scheduleChangeRequests, driverBonusRules, driverScores, driverDevices, sessionRevocations, driverPushTokens, driverEmergencyEvents, driverShiftSwapRequests, tripBilling, accountDeletionRequests, driverShifts, companies } from "@shared/schema";
import { db } from "../db";
import { eq, ne, sql, and, or, not, isNull, inArray, notInArray, desc, gte } from "drizzle-orm";
import { registerPushToken, unregisterPushToken, sendPushToDriver, isPushEnabled } from "../lib/push";
import { sendEmail } from "../lib/email";
import { z } from "zod";
import { enforceCityContext, getAllowedCityId } from "../middleware/cityContext";

const scheduleChangeRateLimit = new Map<number, number[]>();
const SCHEDULE_CHANGE_RATE_LIMIT = 10;
const SCHEDULE_CHANGE_RATE_WINDOW_MS = 60 * 60 * 1000;

const swapRateLimit = new Map<number, number[]>();
const SWAP_RATE_LIMIT = 10;
const SWAP_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function getDriverWithUser(driverId: number) {
  const [row] = await db.select({ driver: drivers, user: { email: users.email } })
    .from(drivers)
    .leftJoin(users, eq(users.driverId, drivers.id))
    .where(eq(drivers.id, driverId));
  return row;
}

async function sendSwapEmail(driverId: number, recipientName: string, otherDriverName: string, swap: any, stage: any) {
  const row = await getDriverWithUser(driverId);
  if (!row?.user?.email) return;
  const { buildSwapNotificationEmail } = await import("../lib/email");
  const content = buildSwapNotificationEmail({
    recipientName,
    otherDriverName,
    shiftDate: swap.shiftDate,
    shiftStart: swap.shiftStart,
    shiftEnd: swap.shiftEnd,
    reason: swap.reason,
    stage,
    decisionNote: stage === "DECLINED" ? swap.targetDecisionNote : stage.includes("DISPATCH") ? swap.dispatchDecisionNote : null,
  });
  const result = await sendEmail({ to: row.user.email, ...content });
  if (!result.success) console.error(`[SWAP] Email to driver ${driverId} failed: ${result.error}`);
}

export async function getDriverMyTripsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const driverTrips = await storage.getTripsByDriverAndDate(user.driverId, date);
    const allDriverTrips = await db.select().from(trips).where(
      and(
        eq(trips.driverId, user.driverId),
        isNull(trips.deletedAt)
      )
    );
    const todayTrips = driverTrips;
    res.json({ todayTrips, allTrips: allDriverTrips.slice(0, 100) });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverProfileHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    const vehicle = driver.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;
    let companyName: string | null = null;
    if (driver.companyId) {
      const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, driver.companyId));
      companyName = company?.name ?? null;
    }
    res.json({ driver, vehicle, companyName });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverActiveHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const { active } = req.body;
    if (typeof active !== "boolean") return res.status(400).json({ message: "active must be boolean" });
    const newStatus = active ? "available" : "off";
    const now = new Date();
    const updateData: any = { dispatchStatus: newStatus, lastSeenAt: now };
    if (active) {
      updateData.lastActiveAt = now;
    } else {
      updateData.lastLat = null;
      updateData.lastLng = null;
    }
    await db.update(drivers).set(updateData).where(eq(drivers.id, user.driverId));
    const driver = await storage.getDriver(user.driverId);
    res.json({ driver });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverBreakHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    const { onBreak } = req.body;
    if (typeof onBreak !== "boolean") return res.status(400).json({ message: "onBreak must be boolean" });
    if (onBreak) {
      if (driver.dispatchStatus === "off") {
        return res.status(400).json({ message: "Cannot go on break while offline. Go online first." });
      }
      const TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW"];
      const activeTrips = await db.select({ id: trips.id }).from(trips).where(
        and(eq(trips.driverId, driver.id), not(inArray(trips.status, TERMINAL as any)))
      ).limit(1);
      if (activeTrips.length > 0) {
        return res.status(400).json({ message: "Cannot go on break while you have active trips." });
      }
      await db.update(drivers).set({ dispatchStatus: "hold", lastSeenAt: new Date() }).where(eq(drivers.id, driver.id));
    } else {
      if (driver.dispatchStatus !== "hold") {
        return res.status(400).json({ message: "You are not currently on break." });
      }
      await db.update(drivers).set({ dispatchStatus: "available", lastSeenAt: new Date() }).where(eq(drivers.id, driver.id));
    }
    const updated = await storage.getDriver(user.driverId);
    res.json({ driver: updated });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverLogoutHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) {
      clearAuthCookie(res, req);
      return res.json({ ok: true });
    }

    await db.insert(sessionRevocations).values({
      userId: user.id,
      companyId: user.companyId || null,
      revokedAfter: new Date(),
      reason: "Driver logout",
    });
    invalidateRevocationCache(user.id);

    if (user.driverId) {
      await db.update(drivers).set({
        dispatchStatus: "off",
        connected: false,
        lastLat: null,
        lastLng: null,
        lastSeenAt: null,
      }).where(eq(drivers.id, user.driverId));
    }

    await storage.createAuditLog({
      userId: user.id,
      action: "DRIVER_LOGOUT",
      entity: "user",
      entityId: user.id,
      details: `Driver ${user.email} logged out via mobile`,
      cityId: null,
    });

    clearAuthCookie(res, req);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDispatchActiveDriversHandler(req: AuthRequest, res: Response) {
  try {
    const enforced = enforceCityContext(req, res);
    if (enforced === false) return;
    const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
    if (cityId === -1) return res.status(403).json({ message: "Access denied" });
    const activeDrivers = await db.select().from(drivers).where(
      and(
        eq(drivers.dispatchStatus, "available"),
        eq(drivers.active, true),
        isNull(drivers.deletedAt),
        ...(cityId && cityId > 0 ? [eq(drivers.cityId, cityId)] : [])
      )
    );
    const allCities = await storage.getCities();
    const cityMap = new Map(allCities.map(c => [c.id, c]));
    const enriched = await Promise.all(activeDrivers.map(async (d) => {
      const vehicle = d.vehicleId ? await storage.getVehicle(d.vehicleId) : null;
      const city = cityMap.get(d.cityId);
      return {
        ...d,
        vehicleName: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
        vehicleType: vehicle?.capability || null,
        cityName: city?.name || null,
      };
    }));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDispatchRevokeSessionsHandler(req: AuthRequest, res: Response) {
  try {
    const driverId = parseInt(String(req.params.id));
    const driver = await storage.getDriver(driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    const driverUser = driver.userId ? await storage.getUser(driver.userId) : null;
    if (!driverUser) return res.status(404).json({ message: "No user account linked to this driver" });

    const { reason } = req.body;
    await db.insert(sessionRevocations).values({
      userId: driverUser.id,
      companyId: driverUser.companyId || null,
      revokedAfter: new Date(),
      reason: reason || "Force logout by dispatch",
      createdByUserId: req.user!.userId,
    });
    invalidateRevocationCache(driverUser.id);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "REVOKE_SESSIONS",
      entity: "driver",
      entityId: driverId,
      details: `Sessions revoked for driver ${driver.firstName} ${driver.lastName}. Reason: ${reason || "Force logout by dispatch"}`,
      cityId: driver.cityId,
    });

    console.log(`[SESSION-REVOKE] User ${req.user!.userId} revoked sessions for driver ${driverId} (userId=${driverUser.id})`);
    res.json({ message: "All sessions revoked", driverId, userId: driverUser.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDispatchDriverDevicesHandler(req: AuthRequest, res: Response) {
  try {
    const driverId = parseInt(String(req.params.id));
    const devices = await db.select().from(driverDevices).where(eq(driverDevices.driverId, driverId));
    res.json(devices);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function deleteDispatchDriverDeviceHandler(req: AuthRequest, res: Response) {
  try {
    const driverId = parseInt(String(req.params.id));
    const deviceId = parseInt(String(req.params.deviceId));
    const device = await db.select().from(driverDevices).where(and(eq(driverDevices.id, deviceId), eq(driverDevices.driverId, driverId))).then(r => r[0]);
    if (!device) return res.status(404).json({ message: "Device not found" });
    await db.delete(driverDevices).where(eq(driverDevices.id, deviceId));
    console.log(`[DEVICE-BIND] Device ${deviceId} removed from driver ${driverId} by user ${req.user!.userId}`);
    res.json({ message: "Device removed" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function handleDriverLocationIngest(req: AuthRequest, res: any) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    const hasActiveTrip = await db.select({ id: trips.id }).from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        isNull(trips.deletedAt),
        sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`,
      )).limit(1).then(r => r.length > 0);

    if (!driver.connected && !hasActiveTrip) {
      return res.status(403).json({ message: "Driver not connected" });
    }

    const { lat, lng, heading, speed, accuracy, isMock } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ message: "lat and lng are required numbers" });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "Invalid coordinates" });
    }

    if (isMock === true) {
      console.warn(`[GPS-GUARD] Mock location detected from driver ${user.driverId}`);
      return res.status(422).json({ message: "Mock locations not accepted" });
    }

    if (typeof accuracy === "number" && accuracy > 500) {
      console.warn(`[GPS-GUARD] Very low accuracy (${accuracy}m) from driver ${user.driverId}`);
    }

    const { cache, cacheKeys, CACHE_TTL } = await import("../lib/cache");

    const prevLocKey = `driver:${user.driverId}:prev_loc`;
    const spoofCountKey = `driver:${user.driverId}:spoof_count`;
    const prevLoc = cache.get<{ lat: number; lng: number; ts: number }>(prevLocKey);
    if (prevLoc) {
      const timeDiffSec = (Date.now() - prevLoc.ts) / 1000;
      if (timeDiffSec > 1) {
        const dLat = lat - prevLoc.lat;
        const dLng = lng - prevLoc.lng;
        const distKm = Math.sqrt(dLat * dLat + dLng * dLng) * 111.32;
        const speedKmH = (distKm / timeDiffSec) * 3600;
        if (speedKmH > 500) {
          const count = (cache.get<number>(spoofCountKey) || 0) + 1;
          cache.set(spoofCountKey, count, 600_000);
          console.warn(`[GPS-GUARD] Teleport rejected for driver ${user.driverId}: ${speedKmH.toFixed(0)} km/h (count: ${count})`);
          return res.status(422).json({ message: "Location update rejected: impossible movement detected" });
        } else if (speedKmH > 300) {
          console.warn(`[GPS-GUARD] High velocity from driver ${user.driverId}: ${speedKmH.toFixed(0)} km/h`);
        }
      }
    }
    cache.set(prevLocKey, { lat, lng, ts: Date.now() }, 300_000);
    const { broadcastToTrip } = await import("../lib/realtime");
    const locKey = cacheKeys("driver_location", user.driverId);
    cache.set(locKey, { driverId: user.driverId, lat, lng, timestamp: Date.now(), heading, speed }, CACHE_TTL.DRIVER_LOCATION);

    const persistKey = cacheKeys("driver_last_persist", user.driverId);
    const lastPersist = cache.get<number>(persistKey);
    if (!lastPersist || (Date.now() - lastPersist) >= 60_000) {
      await db.update(drivers).set({
        lastLat: lat,
        lastLng: lng,
        lastSeenAt: new Date(),
      }).where(eq(drivers.id, user.driverId));
      cache.set(persistKey, Date.now(), 120_000);
    }

    const allTrips = await storage.getActiveTripsForDriver(user.driverId);
    for (const trip of allTrips) {
      const tripLocKey = cacheKeys("trip_driver_last", trip.id);
      cache.set(tripLocKey, { driverId: user.driverId, lat, lng, timestamp: Date.now() }, CACHE_TTL.TRIP_DRIVER_LAST);
      broadcastToTrip(trip.id, { type: "driver_location", data: { driverId: user.driverId, lat, lng, ts: Date.now() } });

      import("../lib/supabaseRealtime").then(({ broadcastTripSupabaseThrottled }) => {
        broadcastTripSupabaseThrottled(trip.id, { type: "driver_location", data: { driverId: user.driverId, lat, lng, ts: Date.now() } });
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverActiveTripHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const companyId = getCompanyIdFromAuth(req);
    const TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW"];
    const conditions = [
      eq(trips.driverId, user.driverId),
      isNull(trips.deletedAt),
      sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`,
    ];
    if (companyId) {
      conditions.push(eq(trips.companyId, companyId));
    }

    const activeTrip = await db.select().from(trips).where(
      and(...conditions)
    ).orderBy(desc(trips.updatedAt)).limit(1);

    if (activeTrip.length === 0) {
      return res.json({ trip: null });
    }

    const trip = activeTrip[0];
    const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;

    res.json({
      trip: {
        id: trip.id,
        publicId: trip.publicId,
        status: trip.status,
        pickupAddress: trip.pickupAddress,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        dropoffAddress: trip.dropoffAddress,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        routePolyline: trip.routePolyline,
        lastEtaMinutes: trip.lastEtaMinutes,
        lastEtaUpdatedAt: trip.lastEtaUpdatedAt,
        distanceMiles: trip.distanceMiles ? Number(trip.distanceMiles) : null,
        scheduledDate: trip.scheduledDate,
        pickupTime: trip.pickupTime,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverPresenceHeartbeatHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver || !driver.active || driver.deletedAt) {
      return res.status(403).json({ message: "Driver profile inactive or deleted" });
    }
    const { lat, lng } = req.body;
    const hasGps = typeof lat === "number" && typeof lng === "number";

    const { cache, cacheKeys, CACHE_TTL } = await import("../lib/cache");

    if (hasGps) {
      const locKey = cacheKeys("driver_location", user.driverId);
      cache.set(locKey, { driverId: user.driverId, lat, lng, timestamp: Date.now() }, CACHE_TTL.DRIVER_LOCATION);
    }

    const persistKey = cacheKeys("driver_last_persist", user.driverId);
    const lastPersist = cache.get<number>(persistKey);
    const shouldPersist = !lastPersist || (Date.now() - lastPersist) >= 60_000;

    if (shouldPersist) {
      const updateData: any = { lastSeenAt: new Date() };
      if (hasGps) {
        updateData.lastLat = lat;
        updateData.lastLng = lng;
      }
      await db.update(drivers).set(updateData).where(eq(drivers.id, user.driverId));
      cache.set(persistKey, Date.now(), 120_000);
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverUpcomingGoTimeHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    if (driver.dispatchStatus === "off") return res.json({ goTimeTrips: [] });

    const city = await storage.getCity(driver.cityId);
    const tz = city?.timezone || "America/New_York";

    const settings = await db.select().from(citySettings).where(eq(citySettings.cityId, driver.cityId)).limit(1);
    const goTimeMinutes = settings[0]?.driverGoTimeMinutes ?? 20;
    const repeatMinutes = settings[0]?.driverGoTimeRepeatMinutes ?? 5;

    const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    const nowMs = Date.now();

    const upcoming = await db.select().from(trips).where(
      and(
        eq(trips.driverId, user.driverId),
        eq(trips.scheduledDate, today),
        inArray(trips.status, ["SCHEDULED", "ASSIGNED"] as any),
        isNull(trips.deletedAt)
      )
    );

    const goTimeTrips: any[] = [];
    for (const trip of upcoming) {
      const timeStr = trip.pickupTime || trip.scheduledTime || "";
      if (!timeStr) continue;

      const [hh, mm] = timeStr.split(":").map(Number);
      if (isNaN(hh) || isNaN(mm)) continue;

      const pickupDate = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
      pickupDate.setHours(hh, mm, 0, 0);
      const pickupMs = pickupDate.getTime();

      const goTimeMs = pickupMs - goTimeMinutes * 60 * 1000;
      const windowEndMs = pickupMs + 5 * 60 * 1000;

      if (nowMs >= goTimeMs && nowMs <= windowEndMs) {
        const secondsUntilPickup = Math.max(0, Math.floor((pickupMs - nowMs) / 1000));

        const existingAlert = await db.select().from(driverTripAlerts).where(
          and(
            eq(driverTripAlerts.tripId, trip.id),
            eq(driverTripAlerts.driverId, user.driverId),
            eq(driverTripAlerts.kind, "go_time")
          )
        ).limit(1);

        let alertRecord = existingAlert[0] || null;
        let shouldShowAlert = true;

        if (alertRecord) {
          if (alertRecord.acknowledgedAt) {
            shouldShowAlert = false;
          } else {
            const lastShown = alertRecord.lastShownAt.getTime();
            if (nowMs - lastShown < repeatMinutes * 60 * 1000) {
              shouldShowAlert = true;
            }
            await db.update(driverTripAlerts).set({ lastShownAt: new Date() }).where(eq(driverTripAlerts.id, alertRecord.id));
          }
        } else {
          const [newAlert] = await db.insert(driverTripAlerts).values({
            tripId: trip.id,
            driverId: user.driverId,
            kind: "go_time",
            firstShownAt: new Date(),
            lastShownAt: new Date(),
          }).returning();
          alertRecord = newAlert;

          const minsLeft = Math.ceil((pickupMs - nowMs) / 60000);
          sendPushToDriver(user.driverId, {
            title: "Go Time!",
            body: `Your pickup at ${trip.pickupAddress || "scheduled location"} is in ${minsLeft} min.`,
            data: { tripId: String(trip.id), action: "go_time", alertId: String(newAlert.id) },
          }).catch(err => console.error(`[PUSH] Go-time push failed:`, err.message));
        }

        const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;

        goTimeTrips.push({
          tripId: trip.id,
          publicId: trip.publicId,
          pickupTime: timeStr,
          pickupAddress: trip.pickupAddress,
          pickupLat: trip.pickupLat,
          pickupLng: trip.pickupLng,
          dropoffAddress: trip.dropoffAddress,
          dropoffLat: trip.dropoffLat,
          dropoffLng: trip.dropoffLng,
          patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
          status: trip.status,
          secondsUntilPickup,
          goTimeMinutes,
          acknowledged: !!alertRecord?.acknowledgedAt,
          alertId: alertRecord?.id,
        });
      }
    }

    res.json({ goTimeTrips });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverGoTimeAcknowledgeHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const alertId = parseInt(String(req.params.alertId));
    if (isNaN(alertId)) return res.status(400).json({ message: "Invalid alert ID" });

    const [alert] = await db.select().from(driverTripAlerts).where(
      and(
        eq(driverTripAlerts.id, alertId),
        eq(driverTripAlerts.driverId, user.driverId)
      )
    );
    if (!alert) return res.status(404).json({ message: "Alert not found" });

    await db.update(driverTripAlerts).set({ acknowledgedAt: new Date() }).where(eq(driverTripAlerts.id, alertId));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverOffersActiveHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const now = new Date();

    await db.update(driverOffers).set({ status: "expired" }).where(
      and(
        eq(driverOffers.driverId, user.driverId),
        eq(driverOffers.status, "pending"),
        sql`${driverOffers.expiresAt} <= ${now}`
      )
    );

    const pendingOffers = await db.select().from(driverOffers).where(
      and(
        eq(driverOffers.driverId, user.driverId),
        eq(driverOffers.status, "pending"),
        sql`${driverOffers.expiresAt} > ${now}`
      )
    ).orderBy(desc(driverOffers.offeredAt));

    const enriched = await Promise.all(pendingOffers.map(async (offer) => {
      const trip = await db.select().from(trips).where(eq(trips.id, offer.tripId)).limit(1);
      const t = trip[0];
      if (!t) return null;
      const patient = t.patientId ? await storage.getPatient(t.patientId) : null;
      const secondsRemaining = Math.max(0, Math.floor((offer.expiresAt.getTime() - now.getTime()) / 1000));
      return {
        offerId: offer.id,
        tripId: t.id,
        publicId: t.publicId,
        pickupAddress: t.pickupAddress,
        pickupLat: t.pickupLat,
        pickupLng: t.pickupLng,
        dropoffAddress: t.dropoffAddress,
        dropoffLat: t.dropoffLat,
        dropoffLng: t.dropoffLng,
        pickupTime: t.pickupTime,
        scheduledDate: t.scheduledDate,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
        status: t.status,
        secondsRemaining,
        expiresAt: offer.expiresAt.toISOString(),
      };
    }));

    res.json({ offers: enriched.filter(Boolean) });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverOfferAcceptHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const [activeShift] = await db.select().from(driverShifts)
      .where(and(eq(driverShifts.driverId, user.driverId), eq(driverShifts.status, "ACTIVE")))
      .limit(1);
    if (!activeShift) return res.status(403).json({ message: "You must start a shift before accepting trips" });

    const offerId = parseInt(String(req.params.offerId));
    if (isNaN(offerId)) return res.status(400).json({ message: "Invalid offer ID" });

    const [offer] = await db.select().from(driverOffers).where(
      and(
        eq(driverOffers.id, offerId),
        eq(driverOffers.driverId, user.driverId)
      )
    );
    if (!offer) return res.status(404).json({ message: "Offer not found" });

    const now = new Date();

    if (offer.status !== "pending") return res.status(409).json({ message: `Offer already ${offer.status}` });
    if (now > offer.expiresAt) {
      await db.update(driverOffers).set({ status: "expired" }).where(eq(driverOffers.id, offerId));
      return res.status(409).json({ message: "Offer has expired" });
    }

    const [accepted] = await db.update(driverOffers)
      .set({ status: "accepted", acceptedAt: now })
      .where(
        and(
          eq(driverOffers.id, offerId),
          eq(driverOffers.status, "pending"),
          sql`${driverOffers.expiresAt} > ${now}`
        )
      )
      .returning();

    if (!accepted) {
      return res.status(409).json({ message: "Offer is no longer available" });
    }

    const [trip] = await db.select().from(trips).where(eq(trips.id, offer.tripId));
    const driver = await storage.getDriver(user.driverId);
    if (trip && (trip.status === "SCHEDULED" || !trip.driverId)) {
      const updateData: any = {
        driverId: user.driverId,
        status: "ASSIGNED",
        assignedAt: now,
        assignedBy: offer.createdBy,
        assignmentSource: "driver_accept",
      };
      if (driver?.vehicleId) updateData.vehicleId = driver.vehicleId;
      await db.update(trips).set(updateData).where(eq(trips.id, offer.tripId));
    }

    import("../lib/realtime").then(({ broadcastToTrip }) => {
      broadcastToTrip(offer.tripId, { type: "status_change", data: { status: "ASSIGNED", tripId: offer.tripId } });
    }).catch(() => {});

    import("../lib/supabaseRealtime").then(({ broadcastTripSupabase }) => {
      broadcastTripSupabase(offer.tripId, { type: "status_change", data: { status: "ASSIGNED", tripId: offer.tripId } });
    }).catch(() => {});

    const smsBaseUrl = process.env.PUBLIC_BASE_URL_APP
      || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://app.unitedcaremobility.com");
    import("../lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
      autoNotifyPatient(offer.tripId, "driver_assigned", { base_url: smsBaseUrl });
    }).catch(() => {});

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "OFFER_ACCEPTED",
      entity: "trip",
      entityId: offer.tripId,
      details: `Driver ${driver?.firstName} ${driver?.lastName} accepted assignment offer for trip ${trip?.publicId}`,
      cityId: trip?.cityId || 0,
    });

    res.json({ ok: true, tripId: offer.tripId });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverOfferDeclineHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const offerId = parseInt(String(req.params.offerId));
    if (isNaN(offerId)) return res.status(400).json({ message: "Invalid offer ID" });

    const [offer] = await db.select().from(driverOffers).where(
      and(
        eq(driverOffers.id, offerId),
        eq(driverOffers.driverId, user.driverId)
      )
    );
    if (!offer) return res.status(404).json({ message: "Offer not found" });
    if (offer.status !== "pending") return res.status(400).json({ message: `Offer already ${offer.status}` });

    await db.update(driverOffers).set({ status: "cancelled" }).where(eq(driverOffers.id, offerId));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverScheduleChangeHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const now = Date.now();
    const driverHits = scheduleChangeRateLimit.get(user.driverId) || [];
    const recent = driverHits.filter(t => now - t < SCHEDULE_CHANGE_RATE_WINDOW_MS);
    if (recent.length >= SCHEDULE_CHANGE_RATE_LIMIT) {
      return res.status(429).json({ message: "Too many requests. Max 10 per hour." });
    }

    const createSchema = z.object({
      requestType: z.enum(["DAY_CHANGE", "TIME_CHANGE", "UNAVAILABLE", "SWAP_REQUEST"]),
      currentDate: z.string().optional(),
      requestedDate: z.string().optional(),
      currentShiftStart: z.string().optional(),
      currentShiftEnd: z.string().optional(),
      requestedShiftStart: z.string().optional(),
      requestedShiftEnd: z.string().optional(),
      reason: z.string().min(3, "Reason must be at least 3 characters"),
    });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid data" });
    }
    const data = parsed.data;

    const driver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
    const companyId = getCompanyIdFromAuth(req) || driver?.companyId || null;

    const [request] = await db.insert(scheduleChangeRequests).values({
      driverId: user.driverId,
      companyId: companyId,
      cityId: driver?.cityId || null,
      requestType: data.requestType,
      currentDate: data.currentDate || null,
      requestedDate: data.requestedDate || null,
      currentShiftStart: data.currentShiftStart || null,
      currentShiftEnd: data.currentShiftEnd || null,
      requestedShiftStart: data.requestedShiftStart || null,
      requestedShiftEnd: data.requestedShiftEnd || null,
      reason: data.reason,
    }).returning();

    recent.push(now);
    scheduleChangeRateLimit.set(user.driverId, recent);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "DRIVER_SCHEDULE_CHANGE_REQUEST_CREATED",
      entity: "schedule_change_request",
      entityId: request.id,
      details: `Type: ${data.requestType}, Requested: ${data.requestedDate || "N/A"}`,
      cityId: driver?.cityId || null,
    });

    res.json(request);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverScheduleChangeHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const statusFilter = req.query.status as string | undefined;
    const conditions: any[] = [eq(scheduleChangeRequests.driverId, user.driverId)];
    if (statusFilter && statusFilter !== "all") {
      conditions.push(eq(scheduleChangeRequests.status, statusFilter.toUpperCase() as any));
    }
    const requests = await db.select().from(scheduleChangeRequests)
      .where(and(...conditions))
      .orderBy(desc(scheduleChangeRequests.createdAt))
      .limit(50);
    res.json(requests);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverScheduleChangeCancelHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [existing] = await db.select().from(scheduleChangeRequests).where(
      and(eq(scheduleChangeRequests.id, id), eq(scheduleChangeRequests.driverId, user.driverId))
    );
    if (!existing) return res.status(404).json({ message: "Request not found" });
    if (existing.status !== "PENDING") return res.status(400).json({ message: "Only PENDING requests can be cancelled" });

    const [updated] = await db.update(scheduleChangeRequests).set({
      status: "CANCELLED" as any,
      updatedAt: new Date(),
    }).where(eq(scheduleChangeRequests.id, id)).returning();

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "DRIVER_SCHEDULE_CHANGE_REQUEST_CANCELLED",
      entity: "schedule_change_request",
      entityId: id,
      details: `Cancelled by driver`,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDispatchScheduleChangeHandler(req: AuthRequest, res: Response) {
  try {
    const statusFilter = req.query.status as string | undefined;
    const cityIdFilter = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
    const companyId = getCompanyIdFromAuth(req);
    const conditions: any[] = [];
    if (statusFilter && statusFilter !== "all") {
      conditions.push(eq(scheduleChangeRequests.status, statusFilter.toUpperCase() as any));
    }
    if (cityIdFilter) {
      conditions.push(eq(scheduleChangeRequests.cityId, cityIdFilter));
    }
    if (companyId) {
      conditions.push(eq(scheduleChangeRequests.companyId, companyId));
    }
    const requests = await db.select({
      request: scheduleChangeRequests,
      driver: { firstName: drivers.firstName, lastName: drivers.lastName, publicId: drivers.publicId, cityId: drivers.cityId },
    }).from(scheduleChangeRequests)
      .innerJoin(drivers, eq(scheduleChangeRequests.driverId, drivers.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(scheduleChangeRequests.createdAt))
      .limit(100);

    const allCities = await storage.getCities();
    const cityMap = new Map(allCities.map(c => [c.id, c.name]));
    const enriched = requests.map(r => ({
      ...r.request,
      driverName: `${r.driver.firstName} ${r.driver.lastName}`,
      driverPublicId: r.driver.publicId,
      cityName: r.request.cityId ? cityMap.get(r.request.cityId) || null : null,
    }));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDispatchScheduleChangeDecideHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const decideSchema = z.object({
      decision: z.enum(["APPROVED", "REJECTED"]),
      decisionNote: z.string().optional(),
    });
    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid data" });
    }
    const data = parsed.data;

    if (data.decision === "REJECTED" && (!data.decisionNote || data.decisionNote.trim().length === 0)) {
      return res.status(400).json({ message: "Decision note is required when rejecting" });
    }

    const [existing] = await db.select().from(scheduleChangeRequests).where(eq(scheduleChangeRequests.id, id));
    if (!existing) return res.status(404).json({ message: "Request not found" });
    if (existing.status !== "PENDING") return res.status(400).json({ message: `Request is already ${existing.status}` });

    const [updated] = await db.update(scheduleChangeRequests).set({
      status: data.decision as any,
      decisionNote: data.decisionNote || null,
      dispatcherUserId: req.user!.userId,
      decidedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(scheduleChangeRequests.id, id)).returning();

    const auditAction = data.decision === "APPROVED"
      ? "DISPATCH_SCHEDULE_CHANGE_REQUEST_APPROVED"
      : "DISPATCH_SCHEDULE_CHANGE_REQUEST_REJECTED";
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: auditAction,
      entity: "schedule_change_request",
      entityId: id,
      details: data.decisionNote || null,
      cityId: existing.cityId || null,
    });

    const driver = await db.select().from(drivers).where(eq(drivers.id, existing.driverId)).then(r => r[0]);
    if (driver?.email) {
      const { buildScheduleDecisionEmail } = await import("../lib/email");
      const emailContent = buildScheduleDecisionEmail({
        driverName: `${driver.firstName} ${driver.lastName}`,
        decision: data.decision,
        requestType: existing.requestType,
        currentDate: existing.currentDate,
        requestedDate: existing.requestedDate,
        requestedShiftStart: existing.requestedShiftStart,
        requestedShiftEnd: existing.requestedShiftEnd,
        decisionNote: data.decisionNote,
      });
      const emailResult = await sendEmail({ to: driver.email, ...emailContent });
      if (!emailResult.success) {
        console.error(`[SCHEDULE-CHANGE] Email to driver ${driver.id} failed: ${emailResult.error}`);
      }
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverSwapCreateHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const now = Date.now();
    const driverHits = swapRateLimit.get(user.driverId) || [];
    const recent = driverHits.filter(t => now - t < SWAP_RATE_WINDOW_MS);
    if (recent.length >= SWAP_RATE_LIMIT) {
      return res.status(429).json({ message: "Too many swap requests. Max 10 per day." });
    }

    const schema = z.object({
      targetDriverId: z.number().int().positive(),
      shiftDate: z.string().min(1),
      shiftStart: z.string().optional(),
      shiftEnd: z.string().optional(),
      reason: z.string().min(3),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
    const { targetDriverId, shiftDate, shiftStart, shiftEnd, reason } = parsed.data;

    if (targetDriverId === user.driverId) return res.status(400).json({ message: "Cannot swap with yourself" });

    const requesterDriver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
    if (!requesterDriver) return res.status(404).json({ message: "Requester driver not found" });

    const targetDriver = await db.select().from(drivers).where(eq(drivers.id, targetDriverId)).then(r => r[0]);
    if (!targetDriver) return res.status(404).json({ message: "Target driver not found" });

    if (requesterDriver.companyId !== targetDriver.companyId) {
      return res.status(403).json({ message: "Target driver must be in the same company" });
    }

    const [swap] = await db.insert(driverShiftSwapRequests).values({
      companyId: requesterDriver.companyId,
      cityId: requesterDriver.cityId,
      requesterDriverId: user.driverId,
      targetDriverId,
      shiftDate,
      shiftStart: shiftStart || null,
      shiftEnd: shiftEnd || null,
      reason,
    }).returning();

    recent.push(now);
    swapRateLimit.set(user.driverId, recent);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "DRIVER_SWAP_REQUEST_CREATED",
      entity: "driver_shift_swap",
      entityId: swap.id,
      details: `Driver ${requesterDriver.firstName} ${requesterDriver.lastName} requested swap with driver ${targetDriver.firstName} ${targetDriver.lastName} for ${shiftDate}`,
      cityId: requesterDriver.cityId,
    });

    sendSwapEmail(targetDriverId, `${targetDriver.firstName}`, `${requesterDriver.firstName} ${requesterDriver.lastName}`, swap, "CREATED").catch(() => {});

    res.status(201).json(swap);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverSwapsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const statusFilter = req.query.status as string | undefined;
    const conditions: any[] = [eq(driverShiftSwapRequests.requesterDriverId, user.driverId)];
    if (statusFilter && statusFilter !== "all") {
      conditions.push(eq(driverShiftSwapRequests.status, statusFilter as any));
    }
    const results = await db.select({
      swap: driverShiftSwapRequests,
      target: { firstName: drivers.firstName, lastName: drivers.lastName, publicId: drivers.publicId },
    }).from(driverShiftSwapRequests)
      .innerJoin(drivers, eq(driverShiftSwapRequests.targetDriverId, drivers.id))
      .where(and(...conditions))
      .orderBy(desc(driverShiftSwapRequests.createdAt))
      .limit(50);
    const enriched = results.map(r => ({
      ...r.swap,
      targetDriverName: `${r.target.firstName} ${r.target.lastName}`,
      targetDriverPublicId: r.target.publicId,
    }));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverSwapsInboxHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const statusFilter = req.query.status as string | undefined;
    const conditions: any[] = [eq(driverShiftSwapRequests.targetDriverId, user.driverId)];
    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "pending") {
        conditions.push(eq(driverShiftSwapRequests.status, "PENDING_TARGET" as any));
      } else {
        conditions.push(eq(driverShiftSwapRequests.status, statusFilter as any));
      }
    }
    const results = await db.select({
      swap: driverShiftSwapRequests,
      requester: { firstName: drivers.firstName, lastName: drivers.lastName, publicId: drivers.publicId },
    }).from(driverShiftSwapRequests)
      .innerJoin(drivers, eq(driverShiftSwapRequests.requesterDriverId, drivers.id))
      .where(and(...conditions))
      .orderBy(desc(driverShiftSwapRequests.createdAt))
      .limit(50);
    const enriched = results.map(r => ({
      ...r.swap,
      requesterDriverName: `${r.requester.firstName} ${r.requester.lastName}`,
      requesterDriverPublicId: r.requester.publicId,
    }));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverSwapCancelHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(driverShiftSwapRequests).where(
      and(eq(driverShiftSwapRequests.id, id), eq(driverShiftSwapRequests.requesterDriverId, user.driverId))
    );
    if (!existing) return res.status(404).json({ message: "Swap request not found" });
    const cancellableStatuses = ["PENDING_TARGET", "ACCEPTED_TARGET", "PENDING_DISPATCH"];
    if (!cancellableStatuses.includes(existing.status)) {
      return res.status(400).json({ message: `Cannot cancel swap in status ${existing.status}` });
    }
    const [updated] = await db.update(driverShiftSwapRequests).set({
      status: "CANCELLED",
      updatedAt: new Date(),
    }).where(eq(driverShiftSwapRequests.id, id)).returning();

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "DRIVER_SWAP_REQUEST_CANCELLED",
      entity: "driver_shift_swap",
      entityId: id,
      details: `Driver cancelled swap request #${id}`,
      cityId: existing.cityId,
    });

    const requesterDriver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
    sendSwapEmail(existing.targetDriverId, "", `${requesterDriver?.firstName || "A driver"} ${requesterDriver?.lastName || ""}`, updated, "CANCELLED").catch(() => {});

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverSwapDecideHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const id = parseInt(String(req.params.id));
    const schema = z.object({
      decision: z.enum(["ACCEPT", "DECLINE"]),
      note: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

    const [existing] = await db.select().from(driverShiftSwapRequests).where(
      and(eq(driverShiftSwapRequests.id, id), eq(driverShiftSwapRequests.targetDriverId, user.driverId))
    );
    if (!existing) return res.status(404).json({ message: "Swap request not found or you are not the target" });
    if (existing.status !== "PENDING_TARGET") {
      return res.status(400).json({ message: `Cannot decide on swap in status ${existing.status}` });
    }

    const newStatus = parsed.data.decision === "ACCEPT" ? "PENDING_DISPATCH" : "DECLINED_TARGET";
    const [updated] = await db.update(driverShiftSwapRequests).set({
      status: newStatus as any,
      targetDecisionNote: parsed.data.note || null,
      targetDecidedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(driverShiftSwapRequests.id, id)).returning();

    const auditAction = parsed.data.decision === "ACCEPT" ? "DRIVER_SWAP_ACCEPTED" : "DRIVER_SWAP_DECLINED";
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: auditAction,
      entity: "driver_shift_swap",
      entityId: id,
      details: `Target driver ${parsed.data.decision.toLowerCase()}ed swap request #${id}`,
      cityId: existing.cityId,
    });

    const targetDriver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
    const stage = parsed.data.decision === "ACCEPT" ? "ACCEPTED" : "DECLINED";
    sendSwapEmail(existing.requesterDriverId, "", `${targetDriver?.firstName || ""} ${targetDriver?.lastName || ""}`, updated, stage).catch(() => {});

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDispatchSwapsHandler(req: AuthRequest, res: Response) {
  try {
    const statusFilter = req.query.status as string | undefined;
    const cityIdFilter = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
    const companyId = getCompanyIdFromAuth(req);
    const conditions: any[] = [];
    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "pending") {
        conditions.push(eq(driverShiftSwapRequests.status, "PENDING_DISPATCH" as any));
      } else {
        conditions.push(eq(driverShiftSwapRequests.status, statusFilter as any));
      }
    }
    if (cityIdFilter) conditions.push(eq(driverShiftSwapRequests.cityId, cityIdFilter));
    if (companyId) conditions.push(eq(driverShiftSwapRequests.companyId, companyId));

    const requesterAlias = db.select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, publicId: drivers.publicId }).from(drivers).as("requester_d");
    const targetAlias = db.select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, publicId: drivers.publicId }).from(drivers).as("target_d");

    const results = await db.select()
      .from(driverShiftSwapRequests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(driverShiftSwapRequests.createdAt))
      .limit(100);

    const driverIds = [...new Set(results.flatMap(r => [r.requesterDriverId, r.targetDriverId]))];
    const driverList = driverIds.length > 0 ? await db.select().from(drivers).where(inArray(drivers.id, driverIds)) : [];
    const driverMap = new Map(driverList.map(d => [d.id, d]));

    const enriched = results.map(r => ({
      ...r,
      requesterDriverName: (() => { const d = driverMap.get(r.requesterDriverId); return d ? `${d.firstName} ${d.lastName}` : `Driver #${r.requesterDriverId}`; })(),
      targetDriverName: (() => { const d = driverMap.get(r.targetDriverId); return d ? `${d.firstName} ${d.lastName}` : `Driver #${r.targetDriverId}`; })(),
    }));

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDispatchSwapDecideHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    const schema = z.object({
      decision: z.enum(["APPROVE", "REJECT"]),
      note: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

    if (parsed.data.decision === "REJECT" && !parsed.data.note?.trim()) {
      return res.status(400).json({ message: "A note is required when rejecting a swap request" });
    }

    const [existing] = await db.select().from(driverShiftSwapRequests).where(eq(driverShiftSwapRequests.id, id));
    if (!existing) return res.status(404).json({ message: "Swap request not found" });
    if (existing.status !== "PENDING_DISPATCH") {
      return res.status(400).json({ message: `Cannot decide on swap in status ${existing.status}` });
    }

    const companyId = getCompanyIdFromAuth(req);
    if (companyId && existing.companyId !== companyId) {
      return res.status(403).json({ message: "Access denied - different company" });
    }

    const newStatus = parsed.data.decision === "APPROVE" ? "APPROVED_DISPATCH" : "REJECTED_DISPATCH";
    const [updated] = await db.update(driverShiftSwapRequests).set({
      status: newStatus as any,
      dispatchUserId: req.user!.userId,
      dispatchDecisionNote: parsed.data.note?.trim() || null,
      dispatchDecidedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(driverShiftSwapRequests.id, id)).returning();

    const auditAction = parsed.data.decision === "APPROVE" ? "DISPATCH_SWAP_APPROVED" : "DISPATCH_SWAP_REJECTED";
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: auditAction,
      entity: "driver_shift_swap",
      entityId: id,
      details: `Dispatch ${parsed.data.decision.toLowerCase()}d swap request #${id}${parsed.data.note ? `: ${parsed.data.note}` : ""}`,
      cityId: existing.cityId,
    });

    const requesterDriver = await db.select().from(drivers).where(eq(drivers.id, existing.requesterDriverId)).then(r => r[0]);
    const targetDriver = await db.select().from(drivers).where(eq(drivers.id, existing.targetDriverId)).then(r => r[0]);
    const stage = parsed.data.decision === "APPROVE" ? "APPROVED_DISPATCH" : "REJECTED_DISPATCH";
    if (requesterDriver) sendSwapEmail(existing.requesterDriverId, requesterDriver.firstName, targetDriver?.firstName || "another driver", updated, stage).catch(() => {});
    if (targetDriver) sendSwapEmail(existing.targetDriverId, targetDriver.firstName, requesterDriver?.firstName || "another driver", updated, stage).catch(() => {});

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverSwapsEligibleHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const requesterDriver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
    if (!requesterDriver) return res.status(404).json({ message: "Driver not found" });

    const conditions: any[] = [
      ne(drivers.id, user.driverId),
      eq(drivers.status, "active" as any),
    ];
    if (requesterDriver.companyId) conditions.push(eq(drivers.companyId, requesterDriver.companyId));
    if (requesterDriver.cityId) conditions.push(eq(drivers.cityId, requesterDriver.cityId));

    const eligible = await db.select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      publicId: drivers.publicId,
    }).from(drivers).where(and(...conditions)).orderBy(drivers.firstName);
    res.json(eligible);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverMetricsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    const now = new Date();
    const weekDay = now.getDay();
    const weekStartDate = new Date(now);
    weekStartDate.setDate(now.getDate() - weekDay);
    const weekStart = weekStartDate.toISOString().split("T")[0];
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);
    const weekEnd = weekEndDate.toISOString().split("T")[0];

    const [currentScore] = await db.select().from(driverScores)
      .where(and(eq(driverScores.driverId, user.driverId), eq(driverScores.weekStart, weekStart)));

    const weekTrips = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        sql`${trips.scheduledDate} >= ${weekStart}`,
        sql`${trips.scheduledDate} <= ${weekEnd}`,
        isNull(trips.deletedAt),
      ));

    const totalTrips = weekTrips.length;
    const completedTrips = weekTrips.filter(t => t.status === "COMPLETED").length;
    const cancelledTrips = weekTrips.filter(t => t.status === "CANCELLED").length;
    const noShowTrips = weekTrips.filter(t => t.status === "NO_SHOW").length;
    const completionRate = totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 0;

    const scoreHistory = await db.select().from(driverScores)
      .where(eq(driverScores.driverId, user.driverId))
      .orderBy(desc(driverScores.weekStart))
      .limit(4);

    res.json({
      weekStart,
      weekEnd,
      totalTrips,
      completedTrips,
      cancelledTrips,
      noShowTrips,
      completionRate,
      onTimeRate: currentScore?.onTimeRate != null ? Math.round(currentScore.onTimeRate * 100) : null,
      score: currentScore?.score ?? null,
      history: scoreHistory,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverBonusProgressHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    const [rule] = await db.select().from(driverBonusRules).where(eq(driverBonusRules.cityId, driver.cityId));
    if (!rule || !rule.isEnabled) {
      return res.json({ active: false });
    }

    const criteria = (rule.criteriaJson as any) || {};
    const minTrips = criteria.minTrips ?? 20;
    const minOnTimeRate = criteria.minOnTimeRate ?? 90;
    const minCompletionRate = criteria.minCompletionRate ?? 85;

    const now = new Date();
    const weekDay = now.getDay();
    const weekStartDate = new Date(now);
    weekStartDate.setDate(now.getDate() - weekDay);
    const weekStart = weekStartDate.toISOString().split("T")[0];
    const weekEnd = new Date(weekStartDate);
    weekEnd.setDate(weekStartDate.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    const weekTrips = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        sql`${trips.scheduledDate} >= ${weekStart}`,
        sql`${trips.scheduledDate} <= ${weekEndStr}`,
        isNull(trips.deletedAt),
      ));

    const totalTrips = weekTrips.length;
    const completedTrips = weekTrips.filter(t => t.status === "COMPLETED").length;
    const completionRate = totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 0;

    const [scoreRow] = await db.select().from(driverScores)
      .where(and(eq(driverScores.driverId, user.driverId), eq(driverScores.weekStart, weekStart)));
    const onTimeRate = scoreRow?.onTimeRate != null ? Math.round(scoreRow.onTimeRate * 100) : 100;

    const tripsProgress = Math.min(100, Math.round((totalTrips / minTrips) * 100));
    const onTimeProgress = Math.min(100, Math.round((onTimeRate / minOnTimeRate) * 100));
    const completionProgress = Math.min(100, Math.round((completionRate / minCompletionRate) * 100));
    const overallProgress = Math.round((tripsProgress + onTimeProgress + completionProgress) / 3);

    let progressColor: "red" | "yellow" | "green" = "red";
    if (overallProgress >= 100) progressColor = "green";
    else if (overallProgress >= 70) progressColor = "yellow";

    const qualifies = totalTrips >= minTrips && onTimeRate >= minOnTimeRate && completionRate >= minCompletionRate;

    res.json({
      active: true,
      weeklyAmountCents: rule.weeklyAmountCents,
      qualifies,
      overallProgress,
      progressColor,
      requirements: {
        minTrips, currentTrips: totalTrips,
        minOnTimeRate, currentOnTimeRate: onTimeRate,
        minCompletionRate, currentCompletionRate: completionRate,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverSupportEventHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const { tripId, eventType, notes, idempotencyKey } = req.body;
    if (!eventType) return res.status(400).json({ message: "eventType is required" });

    if (idempotencyKey) {
      const { cache } = await import("../lib/cache");
      const idemKey = `idem:support:${idempotencyKey}`;
      const claimed = cache.setIfNotExists(idemKey, true, 600_000);
      if (!claimed) {
        return res.json({ message: "Already recorded", idempotent: true });
      }
    }

    const validTypes = ["patient_not_ready", "patient_no_show", "address_incorrect", "vehicle_issue", "traffic_delay"];
    if (!validTypes.includes(eventType)) return res.status(400).json({ message: "Invalid event type" });

    const { driverSupportEvents } = await import("@shared/schema");
    const [event] = await db.insert(driverSupportEvents).values({
      driverId: user.driverId,
      tripId: tripId || null,
      eventType,
      notes: notes || null,
    }).returning();

    const driver = await storage.getDriver(user.driverId);
    if (tripId) {
      const trip = await storage.getTrip(tripId);
      const tripRef = trip ? (trip.publicId || `#${tripId}`) : `#${tripId}`;
      const eventLabel = eventType.replace(/_/g, " ");
      const msgText = `[Support Alert] ${driver?.firstName} ${driver?.lastName} reported: ${eventLabel}${notes ? ` — ${notes}` : ""} (Trip ${tripRef})`;
      try {
        await db.insert(tripMessages).values({
          tripId,
          senderId: user.id,
          senderRole: "DRIVER",
          message: msgText,
        });
      } catch (msgErr: any) {
        console.warn("[SUPPORT-EVENT] Failed to create trip message:", msgErr.message);
      }
    }

    console.log(`[SUPPORT-EVENT] Driver ${driver?.firstName} ${driver?.lastName} reported ${eventType} for trip ${tripId || "N/A"}`);

    res.json({ event });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDispatchSupportEventsHandler(req: AuthRequest, res: Response) {
  try {
    const { driverSupportEvents } = await import("@shared/schema");
    const events = await db.select().from(driverSupportEvents)
      .orderBy(desc(driverSupportEvents.createdAt))
      .limit(100);

    const enriched = await Promise.all(events.map(async (e) => {
      const driver = await storage.getDriver(e.driverId);
      const trip = e.tripId ? await storage.getTrip(e.tripId) : null;
      return {
        ...e,
        driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
        tripPublicId: trip?.publicId || null,
      };
    }));

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function patchDispatchSupportEventResolveHandler(req: AuthRequest, res: Response) {
  try {
    const { driverSupportEvents } = await import("@shared/schema");
    const eventId = parseInt(String(req.params.id));
    await db.update(driverSupportEvents).set({
      resolved: true,
      resolvedBy: req.user!.userId,
      resolvedAt: new Date(),
    }).where(eq(driverSupportEvents.id, eventId));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverHeartbeatHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    await db.update(drivers).set({ lastSeenAt: new Date() }).where(eq(drivers.id, user.driverId));

    res.json({
      dispatchStatus: driver.dispatchStatus,
      serverTime: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverPushTokenHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const schema = z.object({
      platform: z.enum(["ios", "android", "web"]),
      token: z.string().min(1).max(4096),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });

    await registerPushToken(user.driverId, user.companyId || null, parsed.data.platform, parsed.data.token);
    res.json({ message: "Token registered", pushEnabled: isPushEnabled() });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function deleteDriverPushTokenHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token required" });

    await unregisterPushToken(user.driverId, token);
    res.json({ message: "Token removed" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverScoreHistoryHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const history = await db.select().from(driverScores)
      .where(eq(driverScores.driverId, user.driverId))
      .orderBy(driverScores.weekStart)
      .limit(12);

    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverTripsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const scope = (req.query.scope as string) || "today";
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 50);
    const today = new Date().toISOString().split("T")[0];

    const q = (req.query.q as string)?.trim();
    const statusFilter = req.query.status as string;
    let conditions: any[] = [eq(trips.driverId, user.driverId), isNull(trips.deletedAt)];

    if (scope === "today") {
      conditions.push(eq(trips.scheduledDate, today));
    } else if (scope === "scheduled") {
      conditions.push(sql`${trips.scheduledDate} >= ${today}`);
      conditions.push(sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`);
    } else if (scope === "completed") {
      conditions.push(inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW"]));
    }

    if (q) {
      conditions.push(sql`(
        ${trips.pickupAddress} ILIKE ${'%' + q + '%'} OR
        ${trips.dropoffAddress} ILIKE ${'%' + q + '%'} OR
        ${trips.publicId} ILIKE ${'%' + q + '%'} OR
        CAST(${trips.id} AS TEXT) = ${q}
      )`);
    }
    if (statusFilter) {
      conditions.push(eq(trips.status, statusFilter));
    }

    const total = await db.select({ count: sql<number>`count(*)` }).from(trips)
      .where(and(...conditions)).then(r => Number(r[0]?.count || 0));

    const results = await db.select().from(trips)
      .where(and(...conditions))
      .orderBy(scope === "completed" ? desc(trips.scheduledDate) : trips.scheduledDate)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    res.json({ trips: results, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverEarningsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const range = (req.query.range as string) || "week";
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    let startDate = today;
    if (range === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      startDate = d.toISOString().split("T")[0];
    } else if (range === "month") {
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }

    const completedTrips = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        eq(trips.status, "COMPLETED"),
        sql`${trips.scheduledDate} >= ${startDate}`,
        sql`${trips.scheduledDate} <= ${today}`,
        isNull(trips.deletedAt),
      ));

    let totalCents = 0;
    const billingRecords = await db.select().from(tripBilling)
      .where(inArray(tripBilling.tripId, completedTrips.length > 0 ? completedTrips.map(t => t.id) : [-1]));

    for (const b of billingRecords) {
      totalCents += b.totalCents || 0;
    }

    res.json({
      range,
      startDate,
      endDate: today,
      totalCents,
      tripCount: completedTrips.length,
      items: completedTrips.slice(0, 20).map(t => ({
        tripId: t.id,
        publicId: t.publicId,
        date: t.scheduledDate,
        pickupAddress: t.pickupAddress,
        dropoffAddress: t.dropoffAddress,
        amountCents: billingRecords.find(b => b.tripId === t.id)?.totalCents || 0,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverEmergencyHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    const schema = z.object({
      lat: z.union([z.string(), z.number()]).optional().transform(v => v != null ? String(v) : null),
      lng: z.union([z.string(), z.number()]).optional().transform(v => v != null ? String(v) : null),
      note: z.string().optional(),
    });
    const data = schema.parse(req.body);

    const [event] = await db.insert(driverEmergencyEvents).values({
      driverId: user.driverId,
      companyId: driver.companyId || null,
      lat: data.lat || null,
      lng: data.lng || null,
      note: data.note || null,
    }).returning();

    let companyFilter: any[] = [inArray(users.role, ["ADMIN", "DISPATCH", "SUPER_ADMIN"]), eq(users.active, true), isNull(users.deletedAt)];
    if (driver.companyId) {
      companyFilter.push(or(eq(users.companyId, driver.companyId), isNull(users.companyId)));
    }
    const dispatchUsers = await db.select().from(users).where(and(...companyFilter));
    for (const du of dispatchUsers) {
      if (du.email) {
        await sendEmail({
          to: du.email,
          subject: `EMERGENCY ALERT - Driver ${driver.firstName} ${driver.lastName}`,
          html: `<p style="color:red;font-size:18px;font-weight:bold;">EMERGENCY ALERT</p>
<p>Driver <strong>${driver.firstName} ${driver.lastName}</strong> has triggered an emergency alert.</p>
${data.note ? `<p><strong>Note:</strong> ${data.note}</p>` : ""}
${data.lat && data.lng ? `<p><strong>Location:</strong> <a href="https://maps.google.com/?q=${data.lat},${data.lng}">View on Map</a></p>` : ""}
<p><strong>Time:</strong> ${new Date().toISOString()}</p>`,
        });
      }
    }

    res.json({ ok: true, event });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverConnectHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    await db.update(drivers).set({
      connected: true,
      connectedAt: new Date(),
      lastSeenAt: new Date(),
    }).where(eq(drivers.id, user.driverId));

    await storage.createAuditLog({
      userId: user.id,
      action: "DRIVER_CONNECT",
      entity: "driver",
      entityId: user.driverId,
      details: `Driver ${driver.firstName} ${driver.lastName} connected (mobile)`,
      cityId: driver.cityId,
    });

    res.json({ ok: true, connected: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverDisconnectHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    await db.update(drivers).set({
      connected: false,
      lastSeenAt: new Date(),
    }).where(eq(drivers.id, user.driverId));

    await storage.createAuditLog({
      userId: user.id,
      action: "DRIVER_DISCONNECT",
      entity: "driver",
      entityId: user.driverId,
      details: `Driver ${driver.firstName} ${driver.lastName} disconnected (mobile)`,
      cityId: driver.cityId,
    });

    res.json({ ok: true, connected: false });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverConnectionHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    res.json({
      connected: driver.connected,
      connectedAt: driver.connectedAt,
      lastSeenAt: driver.lastSeenAt,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverSummaryHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const driver = await storage.getDriver(user.driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    const today = new Date().toISOString().split("T")[0];
    const todayTrips = await db.select().from(trips)
      .where(and(eq(trips.driverId, user.driverId), eq(trips.scheduledDate, today), isNull(trips.deletedAt)));

    const activeTripRow = await db.select({ id: trips.id }).from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        isNull(trips.deletedAt),
        sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`,
      )).limit(1);

    const now = new Date();
    const weekDay = now.getDay();
    const weekStartDate = new Date(now);
    weekStartDate.setDate(now.getDate() - weekDay);
    const weekStart = weekStartDate.toISOString().split("T")[0];
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);
    const weekEnd = weekEndDate.toISOString().split("T")[0];

    const weekTrips = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        sql`${trips.scheduledDate} >= ${weekStart}`,
        sql`${trips.scheduledDate} <= ${weekEnd}`,
        isNull(trips.deletedAt),
      ));

    const [currentScore] = await db.select().from(driverScores)
      .where(and(eq(driverScores.driverId, user.driverId), eq(driverScores.weekStart, weekStart)));

    let weekMiles = 0;
    for (const t of weekTrips.filter(t => t.status === "COMPLETED")) {
      weekMiles += t.distanceMiles ? Number(t.distanceMiles) : 0;
    }

    res.json({
      connected: driver.connected,
      lastSeenAt: driver.lastSeenAt,
      activeTripId: activeTripRow.length > 0 ? activeTripRow[0].id : null,
      today: {
        assigned: todayTrips.filter(t => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(t.status)).length,
        completed: todayTrips.filter(t => t.status === "COMPLETED").length,
        cancelled: todayTrips.filter(t => t.status === "CANCELLED").length,
        noShow: todayTrips.filter(t => t.status === "NO_SHOW").length,
      },
      week: {
        completed: weekTrips.filter(t => t.status === "COMPLETED").length,
        miles: Math.round(weekMiles * 10) / 10,
      },
      score: currentScore?.score ?? null,
      bonusEstimate: null,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverTripsActiveHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const activeTrips = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        isNull(trips.deletedAt),
        sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`,
      )).orderBy(desc(trips.updatedAt)).limit(1);

    if (activeTrips.length === 0) return res.json({ trip: null });

    const trip = activeTrips[0];
    const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;

    res.json({
      trip: {
        id: trip.id,
        publicId: trip.publicId,
        status: trip.status,
        pickupAddress: trip.pickupAddress,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        dropoffAddress: trip.dropoffAddress,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        routePolyline: trip.routePolyline,
        lastEtaMinutes: trip.lastEtaMinutes,
        lastEtaUpdatedAt: trip.lastEtaUpdatedAt,
        distanceMiles: trip.distanceMiles ? Number(trip.distanceMiles) : null,
        scheduledDate: trip.scheduledDate,
        pickupTime: trip.pickupTime,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
        patientPhone: patient?.phone || null,
        scheduledPickupAt: (trip as any).scheduledPickupAt,
        enRoutePickupAt: (trip as any).enRoutePickupAt,
        arrivedPickupAt: trip.arrivedPickupAt,
        pickedUpAt: trip.pickedUpAt,
        enRouteDropoffAt: trip.enRouteDropoffAt,
        arrivedDropoffAt: trip.arrivedDropoffAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverTripsUpcomingHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const days = Math.min(parseInt(req.query.days as string) || 7, 30);
    const today = new Date().toISOString().split("T")[0];
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    const endDateStr = endDate.toISOString().split("T")[0];

    const upcoming = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        isNull(trips.deletedAt),
        sql`${trips.scheduledDate} >= ${today}`,
        sql`${trips.scheduledDate} <= ${endDateStr}`,
        sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`,
      )).orderBy(trips.scheduledDate, trips.pickupTime);

    const results = await Promise.all(upcoming.map(async (trip) => {
      const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
      return {
        id: trip.id,
        publicId: trip.publicId,
        status: trip.status,
        scheduledDate: trip.scheduledDate,
        pickupTime: trip.pickupTime,
        pickupAddress: trip.pickupAddress,
        dropoffAddress: trip.dropoffAddress,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
        distanceMiles: trip.distanceMiles ? Number(trip.distanceMiles) : null,
      };
    }));

    res.json({ trips: results });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverTripsHistoryHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const history = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        isNull(trips.deletedAt),
        inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW"]),
      )).orderBy(desc(trips.scheduledDate)).limit(limit);

    const results = history.map(trip => ({
      id: trip.id,
      publicId: trip.publicId,
      status: trip.status,
      scheduledDate: trip.scheduledDate,
      pickupTime: trip.pickupTime,
      pickupAddress: trip.pickupAddress,
      dropoffAddress: trip.dropoffAddress,
      distanceMiles: trip.distanceMiles ? Number(trip.distanceMiles) : null,
      completedAt: trip.completedAt,
      cancelledAt: trip.cancelledAt,
    }));

    res.json({ trips: results });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverScheduleHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const today = new Date().toISOString().split("T")[0];
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);
    const endDateStr = endDate.toISOString().split("T")[0];

    const scheduled = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        isNull(trips.deletedAt),
        sql`${trips.scheduledDate} >= ${today}`,
        sql`${trips.scheduledDate} <= ${endDateStr}`,
        sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`,
      )).orderBy(trips.scheduledDate, trips.pickupTime);

    const items = scheduled.map(trip => ({
      tripId: trip.id,
      publicId: trip.publicId,
      date: trip.scheduledDate,
      time: trip.pickupTime,
      pickupAddress: trip.pickupAddress,
      dropoffAddress: trip.dropoffAddress,
      status: trip.status,
    }));

    res.json({ items });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverMetricsWeeklyHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const now = new Date();
    const weekDay = now.getDay();
    const weekStartDate = new Date(now);
    weekStartDate.setDate(now.getDate() - weekDay);
    const weekStart = weekStartDate.toISOString().split("T")[0];
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);
    const weekEnd = weekEndDate.toISOString().split("T")[0];

    const [currentScore] = await db.select().from(driverScores)
      .where(and(eq(driverScores.driverId, user.driverId), eq(driverScores.weekStart, weekStart)));

    const weekTrips = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        sql`${trips.scheduledDate} >= ${weekStart}`,
        sql`${trips.scheduledDate} <= ${weekEnd}`,
        isNull(trips.deletedAt),
      ));

    const completedTrips = weekTrips.filter(t => t.status === "COMPLETED");
    let totalMiles = 0;
    for (const t of completedTrips) {
      totalMiles += t.distanceMiles ? Number(t.distanceMiles) : 0;
    }

    const [bonusRule] = await db.select().from(driverBonusRules)
      .where(eq(driverBonusRules.cityId, (await storage.getDriver(user.driverId))?.cityId || 0));

    res.json({
      weekStart,
      weekEnd,
      totalTrips: weekTrips.length,
      completedTrips: completedTrips.length,
      cancelledTrips: weekTrips.filter(t => t.status === "CANCELLED").length,
      noShowTrips: weekTrips.filter(t => t.status === "NO_SHOW").length,
      completionRate: weekTrips.length > 0 ? Math.round((completedTrips.length / weekTrips.length) * 100) : 0,
      onTimeRate: currentScore?.onTimeRate != null ? Math.round(currentScore.onTimeRate * 100) : null,
      score: currentScore?.score ?? null,
      totalMiles: Math.round(totalMiles * 10) / 10,
      bonusActive: bonusRule?.isEnabled || false,
      bonusAmount: bonusRule?.isEnabled ? (bonusRule as any).bonusAmountCents : null,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverAccountDeletionRequestHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const existing = await db.select().from(accountDeletionRequests)
      .where(and(
        eq(accountDeletionRequests.userId, user.id),
        eq(accountDeletionRequests.status, "requested"),
      )).limit(1);

    if (existing.length > 0) {
      return res.json({ ok: true, message: "Deletion request already pending", requestId: existing[0].id });
    }

    const { reason } = req.body || {};
    const [request] = await db.insert(accountDeletionRequests).values({
      userId: user.id,
      role: user.role,
      reason: reason || null,
      status: "requested",
    }).returning();

    await storage.createAuditLog({
      userId: user.id,
      action: "ACCOUNT_DELETION_REQUEST",
      entity: "user",
      entityId: user.id,
      details: `Driver ${user.email} requested account deletion. Reason: ${reason || "none"}`,
      cityId: null,
    });

    res.json({ ok: true, requestId: request.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
