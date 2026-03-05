import type { Express, Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { optimizeDailyRoutes } from "../services/route-optimizer/optimizeDailyRoutes";

export function registerRouteOptimizeRoutes(app: Express) {
  app.post(
    "/api/routes/optimize",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const { city_id, clinic_id, date } = req.body;

        const result = await optimizeDailyRoutes({
          cityId: city_id ? Number(city_id) : undefined,
          clinicId: clinic_id ? Number(clinic_id) : undefined,
          date: date || undefined,
          dryRun: false,
        });

        res.json({
          routesCreated: result.routesCreated,
          tripsAssigned: result.tripsAssigned,
          failedClusters: result.failedClusters,
          errors: result.errors,
          routes: result.routes,
        });
      } catch (err: any) {
        console.error("[ROUTE-OPTIMIZER] Optimize error:", err.message);
        res.status(500).json({ error: "Route optimization failed", detail: err.message });
      }
    }
  );
}
