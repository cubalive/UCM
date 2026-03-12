import type { Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import { requireBrokerScope, requireBrokerAdmin } from "../middleware/requireBrokerScope";
import {
  brokerDashboardHandler,
  brokerTripRequestsListHandler,
  brokerTripRequestDetailHandler,
  brokerCreateTripRequestHandler,
  brokerUpdateTripRequestStatusHandler,
  brokerBidsListHandler,
  brokerSubmitBidHandler,
  brokerAwardBidHandler,
  brokerAutoAwardHandler,
  brokerContractsListHandler,
  brokerCreateContractHandler,
  brokerContractDetailHandler,
  brokerSettlementsListHandler,
  brokerSettlementDetailHandler,
  brokerGenerateSettlementHandler,
  brokerProfileHandler,
  brokerAnalyticsHandler,
  brokerAnalyticsEnhancedHandler,
  brokerSLASummaryHandler,
  brokerSLAViolationsHandler,
  brokerComplianceSummaryHandler,
  brokerComplianceAuditTrailHandler,
  brokerMessagesListHandler,
  brokerSendMessageHandler,
  brokerMessageTemplatesHandler,
  brokerDisputesListHandler,
  brokerCreateDisputeHandler,
  brokerUpdateDisputeHandler,
  brokerLiveTripsHandler,
  brokerProviderRatingsHandler,
  brokerSubmitRatingHandler,
  brokerSettingsGetHandler,
  brokerSettingsUpdateHandler,
  marketplaceOpenRequestsHandler,
  adminBrokersListHandler,
  adminCreateBrokerHandler,
  adminUpdateBrokerHandler,
} from "../controllers/broker-portal.controller";

export function registerBrokerPortalRoutes(app: Express) {
  // ─── Broker Portal Routes (broker users) ──────────────────────────────────

  // Dashboard
  app.get("/api/broker/dashboard", authMiddleware, requireBrokerScope as any, brokerDashboardHandler as any);

  // Profile
  app.get("/api/broker/profile", authMiddleware, requireBrokerScope as any, brokerProfileHandler as any);

  // Trip Requests
  app.get("/api/broker/trip-requests", authMiddleware, requireBrokerScope as any, brokerTripRequestsListHandler as any);
  app.get("/api/broker/trip-requests/:id", authMiddleware, requireBrokerScope as any, brokerTripRequestDetailHandler as any);
  app.post("/api/broker/trip-requests", authMiddleware, requireBrokerScope as any, brokerCreateTripRequestHandler as any);
  app.patch("/api/broker/trip-requests/:id/status", authMiddleware, requireBrokerScope as any, brokerUpdateTripRequestStatusHandler as any);

  // Bids (view bids on their requests)
  app.get("/api/broker/trip-requests/:requestId/bids", authMiddleware, requireBrokerScope as any, brokerBidsListHandler as any);
  app.post("/api/broker/bids/:bidId/award", authMiddleware, requireBrokerAdmin as any, brokerAwardBidHandler as any);
  app.post("/api/broker/trip-requests/:requestId/auto-award", authMiddleware, requireBrokerAdmin as any, brokerAutoAwardHandler as any);

  // Contracts
  app.get("/api/broker/contracts", authMiddleware, requireBrokerScope as any, brokerContractsListHandler as any);
  app.get("/api/broker/contracts/:id", authMiddleware, requireBrokerScope as any, brokerContractDetailHandler as any);
  app.post("/api/broker/contracts", authMiddleware, requireBrokerAdmin as any, brokerCreateContractHandler as any);

  // Settlements
  app.get("/api/broker/settlements", authMiddleware, requireBrokerScope as any, brokerSettlementsListHandler as any);
  app.get("/api/broker/settlements/:id", authMiddleware, requireBrokerScope as any, brokerSettlementDetailHandler as any);
  app.post("/api/broker/settlements/generate", authMiddleware, requireBrokerAdmin as any, brokerGenerateSettlementHandler as any);

  // Analytics
  app.get("/api/broker/analytics", authMiddleware, requireBrokerScope as any, brokerAnalyticsHandler as any);
  app.get("/api/broker/analytics/enhanced", authMiddleware, requireBrokerScope as any, brokerAnalyticsEnhancedHandler as any);

  // SLA Monitoring
  app.get("/api/broker/sla/summary", authMiddleware, requireBrokerScope as any, brokerSLASummaryHandler as any);
  app.get("/api/broker/sla/violations", authMiddleware, requireBrokerScope as any, brokerSLAViolationsHandler as any);

  // Compliance
  app.get("/api/broker/compliance/summary", authMiddleware, requireBrokerScope as any, brokerComplianceSummaryHandler as any);
  app.get("/api/broker/compliance/audit-trail", authMiddleware, requireBrokerScope as any, brokerComplianceAuditTrailHandler as any);

  // Communications
  app.get("/api/broker/messages", authMiddleware, requireBrokerScope as any, brokerMessagesListHandler as any);
  app.post("/api/broker/messages", authMiddleware, requireBrokerScope as any, brokerSendMessageHandler as any);
  app.get("/api/broker/message-templates", authMiddleware, requireBrokerScope as any, brokerMessageTemplatesHandler as any);

  // Disputes
  app.get("/api/broker/disputes", authMiddleware, requireBrokerScope as any, brokerDisputesListHandler as any);
  app.post("/api/broker/disputes", authMiddleware, requireBrokerScope as any, brokerCreateDisputeHandler as any);
  app.patch("/api/broker/disputes/:id", authMiddleware, requireBrokerScope as any, brokerUpdateDisputeHandler as any);

  // Live Trip Tracking
  app.get("/api/broker/live-trips", authMiddleware, requireBrokerScope as any, brokerLiveTripsHandler as any);

  // Provider Ratings
  app.get("/api/broker/provider-ratings", authMiddleware, requireBrokerScope as any, brokerProviderRatingsHandler as any);
  app.post("/api/broker/provider-ratings", authMiddleware, requireBrokerScope as any, brokerSubmitRatingHandler as any);

  // Settings
  app.get("/api/broker/settings", authMiddleware, requireBrokerScope as any, brokerSettingsGetHandler as any);
  app.patch("/api/broker/settings", authMiddleware, requireBrokerAdmin as any, brokerSettingsUpdateHandler as any);

  // ─── Marketplace Routes (for transport companies to find & bid) ───────────

  app.get("/api/marketplace/requests", authMiddleware, marketplaceOpenRequestsHandler as any);
  app.post("/api/marketplace/requests/:requestId/bid", authMiddleware, brokerSubmitBidHandler as any);

  // ─── Admin Routes (platform-level broker management) ──────────────────────

  app.get("/api/admin/brokers", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN") as any, adminBrokersListHandler as any);
  app.post("/api/admin/brokers", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN") as any, adminCreateBrokerHandler as any);
  app.patch("/api/admin/brokers/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN") as any, adminUpdateBrokerHandler as any);
}
