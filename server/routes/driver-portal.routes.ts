import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import {
  postDriverShiftStartHandler,
  postDriverShiftEndHandler,
  getDriverActiveShiftHandler,
  getDriverShiftHistoryHandler,
  postNoShowEvidenceHandler,
  postSignatureRefusedHandler,
  getDriverGeofenceCheckHandler,
  getDriverShiftEarningsHandler,
} from "../controllers/driver-shift.controller";
import {
  getDriverMeHandler,
  patchDriverMeHandler,
  getDriverTripDetailHandler,
  postDriverTripStatusHandler,
  getDriverMyTripsHandler,
  getDriverProfileHandler,
  postDriverActiveHandler,
  postDriverBreakHandler,
  postDriverLogoutHandler,
  getDispatchActiveDriversHandler,
  postDispatchRevokeSessionsHandler,
  getDispatchDriverDevicesHandler,
  deleteDispatchDriverDeviceHandler,
  handleDriverLocationIngest,
  getDriverActiveTripHandler,
  postDriverPresenceHeartbeatHandler,
  getDriverUpcomingGoTimeHandler,
  postDriverGoTimeAcknowledgeHandler,
  getDriverOffersActiveHandler,
  postDriverOfferAcceptHandler,
  postDriverOfferDeclineHandler,
  postDriverScheduleChangeHandler,
  getDriverScheduleChangeHandler,
  postDriverScheduleChangeCancelHandler,
  getDispatchScheduleChangeHandler,
  postDispatchScheduleChangeDecideHandler,
  postDriverSwapCreateHandler,
  getDriverSwapsHandler,
  getDriverSwapsInboxHandler,
  postDriverSwapCancelHandler,
  postDriverSwapDecideHandler,
  getDispatchSwapsHandler,
  postDispatchSwapDecideHandler,
  getDriverSwapsEligibleHandler,
  getDriverMetricsHandler,
  getDriverBonusProgressHandler,
  postDriverSupportEventHandler,
  getDispatchSupportEventsHandler,
  patchDispatchSupportEventResolveHandler,
  postDriverHeartbeatHandler,
  postDriverPushTokenHandler,
  deleteDriverPushTokenHandler,
  getDriverScoreHistoryHandler,
  getDriverTripsHandler,
  getDriverEarningsHandler,
  postDriverEmergencyHandler,
  postDriverConnectHandler,
  postDriverDisconnectHandler,
  getDriverConnectionHandler,
  getDriverSummaryHandler,
  getDriverTripsActiveHandler,
  getDriverTripsUpcomingHandler,
  getDriverTripsHistoryHandler,
  getDriverScheduleHandler,
  getDriverMetricsWeeklyHandler,
  postDriverAccountDeletionRequestHandler,
  getDriverSettingsHandler,
  patchDriverSettingsHandler,
  getDriverV3FlagsHandler,
  getDriverPerformanceCurrentShiftHandler,
  extendWaitingHandler,
  postDriverTelemetryHandler,
} from "../controllers/driver-portal.controller";

const router = express.Router();

router.get("/api/driver/me", authMiddleware, requireRole("DRIVER"), getDriverMeHandler as any);
router.patch("/api/driver/me", authMiddleware, requireRole("DRIVER"), patchDriverMeHandler as any);
router.get("/api/driver/my-trips", authMiddleware, requireRole("DRIVER"), getDriverMyTripsHandler as any);
router.get("/api/driver/profile", authMiddleware, requireRole("DRIVER"), getDriverProfileHandler as any);
router.post("/api/driver/me/active", authMiddleware, requireRole("DRIVER"), postDriverActiveHandler as any);
router.post("/api/driver/me/break", authMiddleware, requireRole("DRIVER"), postDriverBreakHandler as any);

router.post("/api/auth/driver-logout", authMiddleware, postDriverLogoutHandler as any);

router.get("/api/dispatch/drivers/active", authMiddleware, requirePermission("dispatch", "read"), getDispatchActiveDriversHandler as any);
router.post("/api/dispatch/drivers/:id/revoke-sessions", authMiddleware, requireRole("DISPATCH", "ADMIN"), postDispatchRevokeSessionsHandler as any);
router.get("/api/dispatch/drivers/:id/devices", authMiddleware, requireRole("DISPATCH", "ADMIN"), getDispatchDriverDevicesHandler as any);
router.delete("/api/dispatch/drivers/:id/devices/:deviceId", authMiddleware, requireRole("DISPATCH", "ADMIN"), deleteDispatchDriverDeviceHandler as any);

router.post("/api/driver/me/location", authMiddleware, requireRole("DRIVER"), handleDriverLocationIngest as any);
router.post("/api/driver/location", authMiddleware, requireRole("DRIVER"), handleDriverLocationIngest as any);
router.post("/api/driver/location/ping", authMiddleware, requireRole("DRIVER"), handleDriverLocationIngest as any);

router.get("/api/driver/active-trip", authMiddleware, requireRole("DRIVER"), getDriverActiveTripHandler as any);
router.post("/api/driver/presence/heartbeat", authMiddleware, requireRole("DRIVER"), postDriverPresenceHeartbeatHandler as any);

router.get("/api/driver/upcoming-go-time", authMiddleware, requireRole("DRIVER"), getDriverUpcomingGoTimeHandler as any);
router.post("/api/driver/go-time/:alertId/acknowledge", authMiddleware, requireRole("DRIVER"), postDriverGoTimeAcknowledgeHandler as any);

router.get("/api/driver/offers/active", authMiddleware, requireRole("DRIVER"), getDriverOffersActiveHandler as any);
router.post("/api/driver/offers/:offerId/accept", authMiddleware, requireRole("DRIVER"), postDriverOfferAcceptHandler as any);
router.post("/api/driver/offers/:offerId/decline", authMiddleware, requireRole("DRIVER"), postDriverOfferDeclineHandler as any);

router.post("/api/driver/schedule-change", authMiddleware, requireRole("DRIVER"), postDriverScheduleChangeHandler as any);
router.get("/api/driver/schedule-change", authMiddleware, requireRole("DRIVER"), getDriverScheduleChangeHandler as any);
router.post("/api/driver/schedule-change/:id/cancel", authMiddleware, requireRole("DRIVER"), postDriverScheduleChangeCancelHandler as any);

router.get("/api/dispatch/schedule-change", authMiddleware, requirePermission("dispatch", "read"), getDispatchScheduleChangeHandler as any);
router.post("/api/dispatch/schedule-change/:id/decide", authMiddleware, requirePermission("dispatch", "write"), postDispatchScheduleChangeDecideHandler as any);

router.post("/api/driver/swaps", authMiddleware, requireRole("DRIVER"), postDriverSwapCreateHandler as any);
router.get("/api/driver/swaps", authMiddleware, requireRole("DRIVER"), getDriverSwapsHandler as any);
router.get("/api/driver/swaps/inbox", authMiddleware, requireRole("DRIVER"), getDriverSwapsInboxHandler as any);
router.post("/api/driver/swaps/:id/cancel", authMiddleware, requireRole("DRIVER"), postDriverSwapCancelHandler as any);
router.post("/api/driver/swaps/:id/decide", authMiddleware, requireRole("DRIVER"), postDriverSwapDecideHandler as any);
router.get("/api/driver/swaps/eligible", authMiddleware, requireRole("DRIVER"), getDriverSwapsEligibleHandler as any);

router.get("/api/dispatch/swaps", authMiddleware, requirePermission("dispatch", "read"), getDispatchSwapsHandler as any);
router.post("/api/dispatch/swaps/:id/decide", authMiddleware, requirePermission("dispatch", "write"), postDispatchSwapDecideHandler as any);

router.get("/api/driver/metrics", authMiddleware, requireRole("DRIVER"), getDriverMetricsHandler as any);
router.get("/api/driver/bonus-progress", authMiddleware, requireRole("DRIVER"), getDriverBonusProgressHandler as any);

router.post("/api/driver/support-event", authMiddleware, requireRole("DRIVER"), postDriverSupportEventHandler as any);
router.get("/api/dispatch/support-events", authMiddleware, requirePermission("dispatch", "read"), getDispatchSupportEventsHandler as any);
router.patch("/api/dispatch/support-events/:id/resolve", authMiddleware, requirePermission("dispatch", "write"), patchDispatchSupportEventResolveHandler as any);

router.post("/api/driver/heartbeat", authMiddleware, requireRole("DRIVER"), postDriverHeartbeatHandler as any);
router.post("/api/driver/push-token", authMiddleware, requireRole("DRIVER"), postDriverPushTokenHandler as any);
router.delete("/api/driver/push-token", authMiddleware, requireRole("DRIVER"), deleteDriverPushTokenHandler as any);
router.get("/api/driver/score-history", authMiddleware, requireRole("DRIVER"), getDriverScoreHistoryHandler as any);

router.get("/api/driver/trips", authMiddleware, requireRole("DRIVER"), getDriverTripsHandler as any);
router.get("/api/driver/earnings", authMiddleware, requireRole("DRIVER"), getDriverEarningsHandler as any);
router.post("/api/driver/emergency", authMiddleware, requireRole("DRIVER"), postDriverEmergencyHandler as any);

router.post("/api/driver/connect", authMiddleware, requireRole("DRIVER"), postDriverConnectHandler as any);
router.post("/api/driver/disconnect", authMiddleware, requireRole("DRIVER"), postDriverDisconnectHandler as any);
router.get("/api/driver/connection", authMiddleware, requireRole("DRIVER"), getDriverConnectionHandler as any);

router.get("/api/driver/summary", authMiddleware, requireRole("DRIVER"), getDriverSummaryHandler as any);
router.get("/api/driver/trips/active", authMiddleware, requireRole("DRIVER"), getDriverTripsActiveHandler as any);
router.get("/api/driver/trips/upcoming", authMiddleware, requireRole("DRIVER"), getDriverTripsUpcomingHandler as any);
router.get("/api/driver/trips/history", authMiddleware, requireRole("DRIVER"), getDriverTripsHistoryHandler as any);
router.post("/api/driver/trips/:tripId/status", authMiddleware, requireRole("DRIVER"), postDriverTripStatusHandler as any);
router.post("/api/driver/trips/:tripId/extend-wait", authMiddleware, requireRole("DRIVER"), extendWaitingHandler as any);
router.get("/api/driver/trips/:tripId", authMiddleware, requireRole("DRIVER"), getDriverTripDetailHandler as any);
router.get("/api/driver/schedule", authMiddleware, requireRole("DRIVER"), getDriverScheduleHandler as any);
router.get("/api/driver/metrics/weekly", authMiddleware, requireRole("DRIVER"), getDriverMetricsWeeklyHandler as any);

router.post("/api/driver/account-deletion-request", authMiddleware, requireRole("DRIVER"), postDriverAccountDeletionRequestHandler as any);

router.post("/api/driver/shift/start", authMiddleware, requireRole("DRIVER"), postDriverShiftStartHandler as any);
router.post("/api/driver/shift/end", authMiddleware, requireRole("DRIVER"), postDriverShiftEndHandler as any);
router.get("/api/driver/shift/active", authMiddleware, requireRole("DRIVER"), getDriverActiveShiftHandler as any);
router.get("/api/driver/shift/history", authMiddleware, requireRole("DRIVER"), getDriverShiftHistoryHandler as any);
router.post("/api/driver/no-show-evidence", authMiddleware, requireRole("DRIVER"), postNoShowEvidenceHandler as any);
router.post("/api/driver/signature-refused", authMiddleware, requireRole("DRIVER"), postSignatureRefusedHandler as any);
router.get("/api/driver/geofence-check", authMiddleware, requireRole("DRIVER"), getDriverGeofenceCheckHandler as any);
router.get("/api/driver/shift-earnings", authMiddleware, requireRole("DRIVER"), getDriverShiftEarningsHandler as any);

router.get("/api/driver/settings", authMiddleware, requireRole("DRIVER"), getDriverSettingsHandler as any);
router.patch("/api/driver/settings", authMiddleware, requireRole("DRIVER"), patchDriverSettingsHandler as any);
router.get("/api/driver/v3/flags", authMiddleware, requireRole("DRIVER"), getDriverV3FlagsHandler as any);
router.get("/api/driver/performance/current-shift", authMiddleware, requireRole("DRIVER"), getDriverPerformanceCurrentShiftHandler as any);
router.post("/api/driver/telemetry", authMiddleware, requireRole("DRIVER"), postDriverTelemetryHandler as any);

export function registerDriverPortalRoutes(app: Express) {
  app.use(router);
}
