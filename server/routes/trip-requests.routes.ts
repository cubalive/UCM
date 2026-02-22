import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { requireClinicScope } from "../middleware/requireClinicScope";
import {
  clinicCreateTripRequest,
  clinicListTripRequests,
  clinicGetTripRequest,
  clinicCancelTripRequest,
  clinicCreatePatient,
  getRequestChatThread,
  dispatchListTripRequests,
  dispatchApproveTripRequest,
  dispatchRejectTripRequest,
  dispatchNeedsInfoTripRequest,
  getChatMessages,
  sendChatMessage,
} from "../controllers/trip-requests.controller";

export function registerTripRequestRoutes(app: Express) {
  app.post("/api/clinic/trip-requests", authMiddleware, requireClinicScope as any, clinicCreateTripRequest as any);
  app.get("/api/clinic/trip-requests", authMiddleware, requireClinicScope as any, clinicListTripRequests as any);
  app.get("/api/clinic/trip-requests/:id", authMiddleware, requireClinicScope as any, clinicGetTripRequest as any);
  app.patch("/api/clinic/trip-requests/:id/cancel", authMiddleware, requireClinicScope as any, clinicCancelTripRequest as any);
  app.post("/api/clinic/patients/create", authMiddleware, requireClinicScope as any, clinicCreatePatient as any);
  app.get("/api/clinic/trip-requests/:id/chat", authMiddleware, requireClinicScope as any, getRequestChatThread as any);

  app.get("/api/dispatch/trip-requests", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH") as any, dispatchListTripRequests as any);
  app.post("/api/dispatch/trip-requests/:id/approve", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH") as any, dispatchApproveTripRequest as any);
  app.post("/api/dispatch/trip-requests/:id/reject", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH") as any, dispatchRejectTripRequest as any);
  app.post("/api/dispatch/trip-requests/:id/needs-info", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH") as any, dispatchNeedsInfoTripRequest as any);
  app.get("/api/dispatch/trip-requests/:id/chat", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH") as any, getRequestChatThread as any);

  app.get("/api/chat/threads/:threadId/messages", authMiddleware, getChatMessages as any);
  app.post("/api/chat/threads/:threadId/messages", authMiddleware, sendChatMessage as any);
}
