import express, { type Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  getTimezonesHandler,
  getCompaniesHandler,
  createCompanyHandler,
  createCompanyAdminHandler,
  getCitiesHandler,
  createCityHandler,
  updateCityHandler,
  deleteCityHandler,
} from "../controllers/cities.controller";
import {
  getStatesHandler,
  getCitiesByStateHandler,
  resolveCityHandler,
  searchAllCitiesHandler,
} from "../controllers/locations.controller";

const router = express.Router();

router.get("/api/timezones", authMiddleware, getTimezonesHandler as any);
router.get("/api/companies", authMiddleware, requireRole("SUPER_ADMIN"), getCompaniesHandler as any);
router.post("/api/companies", authMiddleware, requireRole("SUPER_ADMIN"), createCompanyHandler as any);
router.post("/api/companies/:id/admin", authMiddleware, requireRole("SUPER_ADMIN"), createCompanyAdminHandler as any);
router.get("/api/cities", authMiddleware, getCitiesHandler as any);
router.post("/api/cities", authMiddleware, requireRole("ADMIN"), createCityHandler as any);
router.patch("/api/cities/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), updateCityHandler as any);
router.delete("/api/cities/:id", authMiddleware, requireRole("SUPER_ADMIN"), deleteCityHandler as any);

router.get("/api/locations/states", authMiddleware, getStatesHandler as any);
router.get("/api/locations/cities", authMiddleware, getCitiesByStateHandler as any);
router.get("/api/locations/resolve", authMiddleware, resolveCityHandler as any);
router.get("/api/locations/search", authMiddleware, searchAllCitiesHandler as any);

export function registerCityRoutes(app: Express) {
  app.use(router);
}
