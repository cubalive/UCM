import { Express, Request, Response } from "express";
import { db } from "../db";
import { trips, drivers, vehicles, assignmentBatches } from "@shared/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { getUserCityIds, type AuthRequest } from "../auth";
import {
  generateAssignmentPlan,
  applyAssignmentBatch,
  cancelAssignmentBatch,
  saveProposals,
  overrideTripAssignment,
} from "./assignmentEngine";

function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: Function) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}

async function checkCityAccess(req: AuthRequest, cityId: number): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "SUPER_ADMIN") return true;
  const allowed = await getUserCityIds(req.user.userId, req.user.role);
  return allowed.includes(cityId);
}

export function registerAssignmentRoutes(app: Express, authMiddleware: any) {
  app.post(
    "/api/assignment-batches/generate",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const { cityId, date } = req.body;
        if (!cityId || !date) {
          return res.status(400).json({ message: "cityId and date are required" });
        }

        if (!(await checkCityAccess(req, parseInt(cityId)))) {
          return res.status(403).json({ message: "No access to this city" });
        }

        const plan = await generateAssignmentPlan(
          parseInt(cityId),
          date,
          req.user!.userId
        );

        await saveProposals(plan.batchId, plan.proposals);

        res.json(plan);
      } catch (err: any) {
        console.error("[AssignmentRoutes] Generate error:", err);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/assignment-batches/:id/apply",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const batchId = parseInt(String(req.params.id));
        const [batch] = await db.select().from(assignmentBatches).where(eq(assignmentBatches.id, batchId));
        if (!batch) return res.status(404).json({ message: "Batch not found" });
        if (!(await checkCityAccess(req, batch.cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }
        const result = await applyAssignmentBatch(batchId);
        res.json({ ok: true, ...result });
      } catch (err: any) {
        console.error("[AssignmentRoutes] Apply error:", err);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/assignment-batches/:id/cancel",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const batchId = parseInt(String(req.params.id));
        const [batch] = await db.select().from(assignmentBatches).where(eq(assignmentBatches.id, batchId));
        if (!batch) return res.status(404).json({ message: "Batch not found" });
        if (!(await checkCityAccess(req, batch.cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }
        await cancelAssignmentBatch(batchId);
        res.json({ ok: true });
      } catch (err: any) {
        console.error("[AssignmentRoutes] Cancel error:", err);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/assignment-batches",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
        const date = req.query.date as string;

        if (cityId && !(await checkCityAccess(req, cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }

        let query = db.select().from(assignmentBatches);
        if (cityId && date) {
          query = query.where(and(eq(assignmentBatches.cityId, cityId), eq(assignmentBatches.date, date))) as any;
        } else if (cityId) {
          query = query.where(eq(assignmentBatches.cityId, cityId)) as any;
        }

        const batches = await query;
        res.json(batches);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/assignment-batches/:id/proposals",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const batchId = parseInt(String(req.params.id));
        const [batch] = await db
          .select()
          .from(assignmentBatches)
          .where(eq(assignmentBatches.id, batchId));

        if (!batch) return res.status(404).json({ message: "Batch not found" });
        if (!(await checkCityAccess(req, batch.cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }

        const batchTrips = await db
          .select()
          .from(trips)
          .where(and(eq(trips.assignmentBatchId, batchId), isNull(trips.deletedAt)));

        const allPatients = await db
          .select()
          .from((await import("@shared/schema")).patients)
          .where(eq((await import("@shared/schema")).patients.cityId, batch.cityId));
        const patientMap = new Map(allPatients.map((p) => [p.id, p]));

        const allDrivers = await db
          .select()
          .from(drivers)
          .where(
            and(eq(drivers.cityId, batch.cityId), eq(drivers.active, true), isNull(drivers.deletedAt))
          );
        const driverMap = new Map(allDrivers.map((d) => [d.id, d]));

        const allVehicles = await db
          .select()
          .from(vehicles)
          .where(
            and(eq(vehicles.cityId, batch.cityId), eq(vehicles.active, true), isNull(vehicles.deletedAt))
          );
        const vehicleMap = new Map(allVehicles.map((v) => [v.id, v]));

        const proposals = batchTrips.map((t) => {
          const patient = patientMap.get(t.patientId);
          const driver = t.driverId ? driverMap.get(t.driverId) : null;
          const vehicle = t.vehicleId ? vehicleMap.get(t.vehicleId) : null;

          return {
            tripId: t.id,
            tripPublicId: t.publicId,
            scheduledDate: t.scheduledDate,
            pickupTime: t.pickupTime,
            pickupZip: t.pickupZip,
            tripType: t.tripType,
            patientId: t.patientId,
            patientName: patient ? `${patient.firstName} ${patient.lastName}` : `Patient #${t.patientId}`,
            wheelchairRequired: patient?.wheelchairRequired ?? false,
            approvalStatus: t.approvalStatus,
            currentStatus: t.status,
            proposedDriverId: t.driverId,
            proposedDriverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
            proposedVehicleId: t.vehicleId,
            proposedVehicleName: vehicle ? vehicle.name : null,
            assignmentSource: t.assignmentSource,
            assignmentReason: t.assignmentReason || "",
            canAssign: t.approvalStatus === "approved",
            blockReason: t.approvalStatus !== "approved" ? "Needs dispatch approval" : null,
          };
        });

        res.json({
          batch,
          proposals,
          drivers: allDrivers.map((d) => ({
            id: d.id,
            name: `${d.firstName} ${d.lastName}`,
            dispatchStatus: d.dispatchStatus,
          })),
          vehicles: allVehicles.map((v) => ({
            id: v.id,
            name: v.name,
            wheelchairAccessible: v.wheelchairAccessible,
          })),
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.patch(
    "/api/assignment-batches/trips/:tripId/override",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const tripId = parseInt(String(req.params.tripId));
        const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
        if (!trip) return res.status(404).json({ message: "Trip not found" });
        if (!(await checkCityAccess(req, trip.cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }
        const { driverId, vehicleId, reason } = req.body;
        await overrideTripAssignment(
          tripId,
          driverId ? parseInt(driverId) : null,
          vehicleId ? parseInt(vehicleId) : null,
          reason
        );
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}
