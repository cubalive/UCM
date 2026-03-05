import type { Express, Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { optimizeDailyRoutes } from "../services/route-optimizer/optimizeDailyRoutes";

export function registerRoutePreviewRoutes(app: Express) {
  app.post(
    "/api/routes/preview",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const { city_id, clinic_id, date } = req.body;

        const result = await optimizeDailyRoutes({
          cityId: city_id ? Number(city_id) : undefined,
          clinicId: clinic_id ? Number(clinic_id) : undefined,
          date: date || undefined,
          dryRun: true,
        });

        res.json({
          preview: true,
          date: date || new Date().toISOString().split("T")[0],
          routesProposed: result.routesCreated,
          tripsMatchable: result.routes.reduce((s, r) => s + r.tripIds.length, 0),
          failedClusters: result.failedClusters,
          errors: result.errors,
          routes: result.routes,
        });
      } catch (err: any) {
        console.error("[ROUTE-OPTIMIZER] Preview error:", err.message);
        res.status(500).json({ error: "Route preview failed", detail: err.message });
      }
    }
  );
}
