import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import {
  brokers,
  brokerContracts,
  brokerTripRequests,
  brokerBids,
  brokerSettlements,
  brokerSettlementItems,
  brokerEvents,
  brokerRateCards,
  brokerPerformanceMetrics,
  companies,
} from "@shared/schema";
import { eq, and, desc, sql, count, sum, avg, inArray, gte, lte } from "drizzle-orm";
import { getBrokerScopeId } from "../middleware/requireBrokerScope";
import {
  generateBrokerPublicId,
  generateContractPublicId,
  generateTripRequestPublicId,
  generateSettlementPublicId,
  evaluateAutoAward,
  generateSettlement,
} from "../lib/marketplaceEngine";

// ─── Dashboard ──────────────────────────────────────────────────────────────

export async function brokerDashboardHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    if (!brokerId) {
      return res.status(403).json({ message: "Broker scope required" });
    }

    const today = new Date().toISOString().split("T")[0];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

    const [statusCounts, recentRequests, activeContracts, pendingSettlements] = await Promise.all([
      db.select({
        status: brokerTripRequests.status,
        count: count(),
      })
        .from(brokerTripRequests)
        .where(and(
          eq(brokerTripRequests.brokerId, brokerId),
          gte(brokerTripRequests.requestedDate, thirtyDaysAgoStr),
        ))
        .groupBy(brokerTripRequests.status),

      db.select()
        .from(brokerTripRequests)
        .where(eq(brokerTripRequests.brokerId, brokerId))
        .orderBy(desc(brokerTripRequests.createdAt))
        .limit(20),

      db.select({ count: count() })
        .from(brokerContracts)
        .where(and(
          eq(brokerContracts.brokerId, brokerId),
          eq(brokerContracts.status, "ACTIVE"),
        )),

      db.select({
        count: count(),
        total: sum(brokerSettlements.netAmount),
      })
        .from(brokerSettlements)
        .where(and(
          eq(brokerSettlements.brokerId, brokerId),
          eq(brokerSettlements.status, "PENDING"),
        )),
    ]);

    const statusMap: Record<string, number> = {};
    for (const s of statusCounts) {
      statusMap[s.status] = Number(s.count);
    }

    res.json({
      today,
      summary: {
        totalRequests30d: Object.values(statusMap).reduce((a, b) => a + b, 0),
        openRequests: (statusMap["OPEN"] || 0) + (statusMap["BIDDING"] || 0),
        awardedRequests: statusMap["AWARDED"] || 0,
        inProgressRequests: statusMap["IN_PROGRESS"] || 0,
        completedRequests: statusMap["COMPLETED"] || 0,
        cancelledRequests: statusMap["CANCELLED"] || 0,
        activeContracts: Number(activeContracts[0]?.count ?? 0),
        pendingSettlements: Number(pendingSettlements[0]?.count ?? 0),
        pendingSettlementAmount: Number(pendingSettlements[0]?.total ?? 0),
      },
      statusBreakdown: statusMap,
      recentRequests,
    });
  } catch (err: any) {
    console.error("[BrokerDashboard]", err);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
}

// ─── Trip Requests CRUD ─────────────────────────────────────────────────────

export async function brokerTripRequestsListHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    if (!brokerId) {
      return res.status(403).json({ message: "Broker scope required" });
    }

    const { status, date, page = "1", limit = "50" } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const conditions = [eq(brokerTripRequests.brokerId, brokerId)];
    if (status && status !== "ALL") {
      conditions.push(eq(brokerTripRequests.status, status as any));
    }
    if (date) {
      conditions.push(eq(brokerTripRequests.requestedDate, date as string));
    }

    const [requests, totalResult] = await Promise.all([
      db.select()
        .from(brokerTripRequests)
        .where(and(...conditions))
        .orderBy(desc(brokerTripRequests.createdAt))
        .limit(Number(limit))
        .offset(offset),
      db.select({ count: count() })
        .from(brokerTripRequests)
        .where(and(...conditions)),
    ]);

    res.json({
      requests,
      total: Number(totalResult[0]?.count ?? 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err: any) {
    console.error("[BrokerTripRequests]", err);
    res.status(500).json({ message: "Failed to load trip requests" });
  }
}

export async function brokerTripRequestDetailHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    const requestId = Number(req.params.id);

    const [request] = await db.select()
      .from(brokerTripRequests)
      .where(and(
        eq(brokerTripRequests.id, requestId),
        brokerId ? eq(brokerTripRequests.brokerId, brokerId) : sql`true`,
      ))
      .limit(1);

    if (!request) {
      return res.status(404).json({ message: "Trip request not found" });
    }

    // Get bids with company info
    const bids = await db.select({
      bid: brokerBids,
      companyName: companies.name,
    })
      .from(brokerBids)
      .leftJoin(companies, eq(brokerBids.companyId, companies.id))
      .where(eq(brokerBids.tripRequestId, requestId))
      .orderBy(brokerBids.bidAmount);

    // Get events
    const events = await db.select()
      .from(brokerEvents)
      .where(eq(brokerEvents.tripRequestId, requestId))
      .orderBy(desc(brokerEvents.createdAt));

    res.json({ request, bids, events });
  } catch (err: any) {
    console.error("[BrokerTripRequestDetail]", err);
    res.status(500).json({ message: "Failed to load trip request" });
  }
}

export async function brokerCreateTripRequestHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    if (!brokerId) {
      return res.status(403).json({ message: "Broker scope required" });
    }

    const publicId = generateTripRequestPublicId();
    const {
      memberName,
      memberId,
      memberPhone,
      memberDob,
      pickupAddress,
      pickupLat,
      pickupLng,
      pickupNotes,
      dropoffAddress,
      dropoffLat,
      dropoffLng,
      dropoffNotes,
      requestedDate,
      requestedPickupTime,
      requestedReturnTime,
      isRoundTrip,
      isRecurring,
      recurrencePattern,
      serviceType,
      wheelchairRequired,
      stretcherRequired,
      attendantRequired,
      oxygenRequired,
      specialNeeds,
      cityId,
      estimatedMiles,
      estimatedMinutes,
      maxBudget,
      preauthorizationNumber,
      diagnosisCode,
      bidDeadline,
      minBids,
      priority,
      urgencyLevel,
      externalReferenceId,
      notes,
    } = req.body;

    const [request] = await db.insert(brokerTripRequests).values({
      publicId,
      brokerId,
      status: "OPEN",
      memberName,
      memberId,
      memberPhone,
      memberDob,
      pickupAddress,
      pickupLat,
      pickupLng,
      pickupNotes,
      dropoffAddress,
      dropoffLat,
      dropoffLng,
      dropoffNotes,
      requestedDate,
      requestedPickupTime,
      requestedReturnTime,
      isRoundTrip: isRoundTrip || false,
      isRecurring: isRecurring || false,
      recurrencePattern,
      serviceType: serviceType || "ambulatory",
      wheelchairRequired: wheelchairRequired || false,
      stretcherRequired: stretcherRequired || false,
      attendantRequired: attendantRequired || false,
      oxygenRequired: oxygenRequired || false,
      specialNeeds,
      cityId,
      estimatedMiles,
      estimatedMinutes,
      maxBudget,
      preauthorizationNumber,
      diagnosisCode,
      bidDeadline: bidDeadline ? new Date(bidDeadline) : null,
      minBids,
      priority: priority || "STANDARD",
      urgencyLevel: urgencyLevel || "NORMAL",
      externalReferenceId,
      notes,
      createdBy: req.user?.userId,
    }).returning();

    await db.insert(brokerEvents).values({
      brokerId,
      tripRequestId: request.id,
      eventType: "TRIP_REQUEST_CREATED",
      description: `Trip request ${publicId} created for ${memberName}`,
      performedBy: req.user?.userId,
    });

    res.status(201).json({ request });
  } catch (err: any) {
    console.error("[BrokerCreateTripRequest]", err);
    res.status(500).json({ message: "Failed to create trip request" });
  }
}

export async function brokerUpdateTripRequestStatusHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    const requestId = Number(req.params.id);
    const { status, reason } = req.body;

    const [request] = await db.select()
      .from(brokerTripRequests)
      .where(and(
        eq(brokerTripRequests.id, requestId),
        brokerId ? eq(brokerTripRequests.brokerId, brokerId) : sql`true`,
      ))
      .limit(1);

    if (!request) {
      return res.status(404).json({ message: "Trip request not found" });
    }

    const updateData: any = { status, updatedAt: new Date() };
    if (status === "BIDDING") {
      // Open for bidding
    } else if (status === "CANCELLED") {
      updateData.cancelledAt = new Date();
      updateData.cancelledReason = reason;
    } else if (status === "COMPLETED") {
      updateData.completedAt = new Date();
    } else if (status === "DISPUTED") {
      updateData.disputedAt = new Date();
      updateData.disputeReason = reason;
    }

    const [updated] = await db.update(brokerTripRequests)
      .set(updateData)
      .where(eq(brokerTripRequests.id, requestId))
      .returning();

    await db.insert(brokerEvents).values({
      brokerId: request.brokerId,
      tripRequestId: requestId,
      eventType: `STATUS_${status}`,
      description: reason || `Status changed to ${status}`,
      performedBy: req.user?.userId,
    });

    res.json({ request: updated });
  } catch (err: any) {
    console.error("[BrokerUpdateTripRequest]", err);
    res.status(500).json({ message: "Failed to update trip request" });
  }
}

// ─── Bids ───────────────────────────────────────────────────────────────────

export async function brokerBidsListHandler(req: AuthRequest, res: Response) {
  try {
    const requestId = Number(req.params.requestId);

    const bids = await db.select({
      bid: brokerBids,
      companyName: companies.name,
    })
      .from(brokerBids)
      .leftJoin(companies, eq(brokerBids.companyId, companies.id))
      .where(eq(brokerBids.tripRequestId, requestId))
      .orderBy(brokerBids.bidAmount);

    res.json({ bids });
  } catch (err: any) {
    console.error("[BrokerBidsList]", err);
    res.status(500).json({ message: "Failed to load bids" });
  }
}

export async function brokerSubmitBidHandler(req: AuthRequest, res: Response) {
  try {
    const requestId = Number(req.params.requestId);
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ message: "Company context required to submit bids" });
    }

    const [request] = await db.select()
      .from(brokerTripRequests)
      .where(and(
        eq(brokerTripRequests.id, requestId),
        inArray(brokerTripRequests.status, ["OPEN", "BIDDING"]),
      ))
      .limit(1);

    if (!request) {
      return res.status(404).json({ message: "Trip request not available for bidding" });
    }

    const {
      bidAmount,
      estimatedPickupTime,
      estimatedDurationMinutes,
      vehicleType,
      slaGuarantee,
      notes,
    } = req.body;

    const [bid] = await db.insert(brokerBids).values({
      tripRequestId: requestId,
      companyId,
      bidAmount,
      estimatedPickupTime,
      estimatedDurationMinutes,
      vehicleType,
      slaGuarantee: slaGuarantee ?? true,
      notes,
      createdBy: req.user?.userId,
    }).returning();

    // Update request status to BIDDING if it was OPEN
    if (request.status === "OPEN") {
      await db.update(brokerTripRequests)
        .set({ status: "BIDDING", updatedAt: new Date() })
        .where(eq(brokerTripRequests.id, requestId));
    }

    await db.insert(brokerEvents).values({
      brokerId: request.brokerId,
      tripRequestId: requestId,
      bidId: bid.id,
      eventType: "BID_SUBMITTED",
      description: `Company ${companyId} bid $${bidAmount}`,
      performedBy: req.user?.userId,
    });

    res.status(201).json({ bid });
  } catch (err: any) {
    console.error("[BrokerSubmitBid]", err);
    res.status(500).json({ message: "Failed to submit bid" });
  }
}

export async function brokerAwardBidHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    const bidId = Number(req.params.bidId);

    const [bid] = await db.select()
      .from(brokerBids)
      .where(eq(brokerBids.id, bidId))
      .limit(1);

    if (!bid || bid.status !== "PENDING") {
      return res.status(404).json({ message: "Bid not found or not pending" });
    }

    // Verify broker owns the trip request
    const [request] = await db.select()
      .from(brokerTripRequests)
      .where(and(
        eq(brokerTripRequests.id, bid.tripRequestId),
        brokerId ? eq(brokerTripRequests.brokerId, brokerId) : sql`true`,
      ))
      .limit(1);

    if (!request) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Accept this bid
    await db.update(brokerBids)
      .set({ status: "ACCEPTED", respondedAt: new Date() })
      .where(eq(brokerBids.id, bidId));

    // Reject other bids
    await db.update(brokerBids)
      .set({ status: "REJECTED", respondedAt: new Date() })
      .where(and(
        eq(brokerBids.tripRequestId, bid.tripRequestId),
        sql`${brokerBids.id} != ${bidId}`,
        eq(brokerBids.status, "PENDING"),
      ));

    // Update trip request
    await db.update(brokerTripRequests)
      .set({
        status: "AWARDED",
        awardedCompanyId: bid.companyId,
        awardedBidId: bidId,
        awardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(brokerTripRequests.id, bid.tripRequestId));

    await db.insert(brokerEvents).values({
      brokerId: request.brokerId,
      tripRequestId: bid.tripRequestId,
      bidId,
      eventType: "BID_AWARDED",
      description: `Bid awarded to company ${bid.companyId} for $${bid.bidAmount}`,
      performedBy: req.user?.userId,
    });

    res.json({ success: true, message: "Bid awarded successfully" });
  } catch (err: any) {
    console.error("[BrokerAwardBid]", err);
    res.status(500).json({ message: "Failed to award bid" });
  }
}

export async function brokerAutoAwardHandler(req: AuthRequest, res: Response) {
  try {
    const requestId = Number(req.params.requestId);
    const result = await evaluateAutoAward(requestId);
    res.json(result);
  } catch (err: any) {
    console.error("[BrokerAutoAward]", err);
    res.status(500).json({ message: "Failed to auto-award" });
  }
}

// ─── Contracts ──────────────────────────────────────────────────────────────

export async function brokerContractsListHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    if (!brokerId) {
      return res.status(403).json({ message: "Broker scope required" });
    }

    const { status, page = "1", limit = "50" } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const conditions = [eq(brokerContracts.brokerId, brokerId)];
    if (status && status !== "ALL") {
      conditions.push(eq(brokerContracts.status, status as any));
    }

    const [contracts, totalResult] = await Promise.all([
      db.select({
        contract: brokerContracts,
        companyName: companies.name,
      })
        .from(brokerContracts)
        .leftJoin(companies, eq(brokerContracts.companyId, companies.id))
        .where(and(...conditions))
        .orderBy(desc(brokerContracts.createdAt))
        .limit(Number(limit))
        .offset(offset),
      db.select({ count: count() })
        .from(brokerContracts)
        .where(and(...conditions)),
    ]);

    res.json({
      contracts,
      total: Number(totalResult[0]?.count ?? 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err: any) {
    console.error("[BrokerContracts]", err);
    res.status(500).json({ message: "Failed to load contracts" });
  }
}

export async function brokerCreateContractHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    if (!brokerId) {
      return res.status(403).json({ message: "Broker scope required" });
    }

    const publicId = generateContractPublicId();
    const [contract] = await db.insert(brokerContracts).values({
      ...req.body,
      publicId,
      brokerId,
      status: "DRAFT",
      createdBy: req.user?.userId,
    }).returning();

    await db.insert(brokerEvents).values({
      brokerId,
      eventType: "CONTRACT_CREATED",
      description: `Contract ${publicId} created with company ${req.body.companyId}`,
      performedBy: req.user?.userId,
    });

    res.status(201).json({ contract });
  } catch (err: any) {
    console.error("[BrokerCreateContract]", err);
    res.status(500).json({ message: "Failed to create contract" });
  }
}

export async function brokerContractDetailHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    const contractId = Number(req.params.id);

    const [contract] = await db.select({
      contract: brokerContracts,
      companyName: companies.name,
    })
      .from(brokerContracts)
      .leftJoin(companies, eq(brokerContracts.companyId, companies.id))
      .where(and(
        eq(brokerContracts.id, contractId),
        brokerId ? eq(brokerContracts.brokerId, brokerId) : sql`true`,
      ))
      .limit(1);

    if (!contract) {
      return res.status(404).json({ message: "Contract not found" });
    }

    const rateCards = await db.select()
      .from(brokerRateCards)
      .where(eq(brokerRateCards.contractId, contractId))
      .orderBy(brokerRateCards.serviceType);

    res.json({ ...contract, rateCards });
  } catch (err: any) {
    console.error("[BrokerContractDetail]", err);
    res.status(500).json({ message: "Failed to load contract" });
  }
}

// ─── Settlements ────────────────────────────────────────────────────────────

export async function brokerSettlementsListHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    if (!brokerId) {
      return res.status(403).json({ message: "Broker scope required" });
    }

    const { status, page = "1", limit = "50" } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const conditions = [eq(brokerSettlements.brokerId, brokerId)];
    if (status && status !== "ALL") {
      conditions.push(eq(brokerSettlements.status, status as any));
    }

    const [settlements, totalResult] = await Promise.all([
      db.select({
        settlement: brokerSettlements,
        companyName: companies.name,
      })
        .from(brokerSettlements)
        .leftJoin(companies, eq(brokerSettlements.companyId, companies.id))
        .where(and(...conditions))
        .orderBy(desc(brokerSettlements.createdAt))
        .limit(Number(limit))
        .offset(offset),
      db.select({ count: count() })
        .from(brokerSettlements)
        .where(and(...conditions)),
    ]);

    res.json({
      settlements,
      total: Number(totalResult[0]?.count ?? 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err: any) {
    console.error("[BrokerSettlements]", err);
    res.status(500).json({ message: "Failed to load settlements" });
  }
}

export async function brokerSettlementDetailHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    const settlementId = Number(req.params.id);

    const [settlement] = await db.select({
      settlement: brokerSettlements,
      companyName: companies.name,
    })
      .from(brokerSettlements)
      .leftJoin(companies, eq(brokerSettlements.companyId, companies.id))
      .where(and(
        eq(brokerSettlements.id, settlementId),
        brokerId ? eq(brokerSettlements.brokerId, brokerId) : sql`true`,
      ))
      .limit(1);

    if (!settlement) {
      return res.status(404).json({ message: "Settlement not found" });
    }

    const items = await db.select()
      .from(brokerSettlementItems)
      .where(eq(brokerSettlementItems.settlementId, settlementId))
      .orderBy(brokerSettlementItems.serviceDate);

    res.json({ ...settlement, items });
  } catch (err: any) {
    console.error("[BrokerSettlementDetail]", err);
    res.status(500).json({ message: "Failed to load settlement" });
  }
}

export async function brokerGenerateSettlementHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    if (!brokerId) {
      return res.status(403).json({ message: "Broker scope required" });
    }

    const { companyId, periodStart, periodEnd } = req.body;
    if (!companyId || !periodStart || !periodEnd) {
      return res.status(400).json({ message: "companyId, periodStart, and periodEnd are required" });
    }

    const result = await generateSettlement(brokerId, companyId, periodStart, periodEnd, req.user?.userId);
    res.status(201).json(result);
  } catch (err: any) {
    console.error("[BrokerGenerateSettlement]", err);
    res.status(500).json({ message: "Failed to generate settlement" });
  }
}

// ─── Marketplace (for transport companies) ──────────────────────────────────

export async function marketplaceOpenRequestsHandler(req: AuthRequest, res: Response) {
  try {
    const { cityId, serviceType, date, page = "1", limit = "50" } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const conditions = [
      inArray(brokerTripRequests.status, ["OPEN", "BIDDING"]),
    ];
    if (cityId) {
      conditions.push(eq(brokerTripRequests.cityId, Number(cityId)));
    }
    if (serviceType) {
      conditions.push(eq(brokerTripRequests.serviceType, serviceType as string));
    }
    if (date) {
      conditions.push(eq(brokerTripRequests.requestedDate, date as string));
    }

    const [requests, totalResult] = await Promise.all([
      db.select({
        request: brokerTripRequests,
        brokerName: brokers.name,
      })
        .from(brokerTripRequests)
        .leftJoin(brokers, eq(brokerTripRequests.brokerId, brokers.id))
        .where(and(...conditions))
        .orderBy(desc(brokerTripRequests.createdAt))
        .limit(Number(limit))
        .offset(offset),
      db.select({ count: count() })
        .from(brokerTripRequests)
        .where(and(...conditions)),
    ]);

    res.json({
      requests,
      total: Number(totalResult[0]?.count ?? 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err: any) {
    console.error("[MarketplaceOpenRequests]", err);
    res.status(500).json({ message: "Failed to load marketplace" });
  }
}

// ─── Broker Profile ─────────────────────────────────────────────────────────

export async function brokerProfileHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    if (!brokerId) {
      return res.status(403).json({ message: "Broker scope required" });
    }

    const [broker] = await db.select()
      .from(brokers)
      .where(eq(brokers.id, brokerId))
      .limit(1);

    if (!broker) {
      return res.status(404).json({ message: "Broker not found" });
    }

    res.json({ broker });
  } catch (err: any) {
    console.error("[BrokerProfile]", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
}

// ─── Broker Analytics ───────────────────────────────────────────────────────

export async function brokerAnalyticsHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = getBrokerScopeId(req);
    if (!brokerId) {
      return res.status(403).json({ message: "Broker scope required" });
    }

    const { period = "6" } = req.query;
    const months = Number(period);
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}`;

    const metrics = await db.select()
      .from(brokerPerformanceMetrics)
      .where(and(
        eq(brokerPerformanceMetrics.brokerId, brokerId),
        gte(brokerPerformanceMetrics.period, sinceStr),
      ))
      .orderBy(brokerPerformanceMetrics.period);

    // Calculate aggregated stats
    const [bidStats] = await db.select({
      avgBidAmount: avg(brokerBids.bidAmount),
      totalBids: count(),
    })
      .from(brokerBids)
      .innerJoin(brokerTripRequests, eq(brokerBids.tripRequestId, brokerTripRequests.id))
      .where(eq(brokerTripRequests.brokerId, brokerId));

    // Top companies by volume
    const topCompanies = await db.select({
      companyId: brokerTripRequests.awardedCompanyId,
      companyName: companies.name,
      tripCount: count(),
    })
      .from(brokerTripRequests)
      .leftJoin(companies, eq(brokerTripRequests.awardedCompanyId, companies.id))
      .where(and(
        eq(brokerTripRequests.brokerId, brokerId),
        sql`${brokerTripRequests.awardedCompanyId} IS NOT NULL`,
      ))
      .groupBy(brokerTripRequests.awardedCompanyId, companies.name)
      .orderBy(desc(count()))
      .limit(10);

    res.json({
      monthlyMetrics: metrics,
      bidStats: bidStats || {},
      topCompanies,
    });
  } catch (err: any) {
    console.error("[BrokerAnalytics]", err);
    res.status(500).json({ message: "Failed to load analytics" });
  }
}

// ─── Admin: Brokers Management ──────────────────────────────────────────────

export async function adminBrokersListHandler(req: AuthRequest, res: Response) {
  try {
    const { status, type, page = "1", limit = "50" } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const conditions: any[] = [];
    if (status && status !== "ALL") {
      conditions.push(eq(brokers.status, status as any));
    }
    if (type && type !== "ALL") {
      conditions.push(eq(brokers.type, type as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [brokerList, totalResult] = await Promise.all([
      db.select()
        .from(brokers)
        .where(whereClause)
        .orderBy(desc(brokers.createdAt))
        .limit(Number(limit))
        .offset(offset),
      db.select({ count: count() })
        .from(brokers)
        .where(whereClause),
    ]);

    res.json({
      brokers: brokerList,
      total: Number(totalResult[0]?.count ?? 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err: any) {
    console.error("[AdminBrokersList]", err);
    res.status(500).json({ message: "Failed to load brokers" });
  }
}

export async function adminCreateBrokerHandler(req: AuthRequest, res: Response) {
  try {
    const publicId = generateBrokerPublicId();
    const [broker] = await db.insert(brokers).values({
      ...req.body,
      publicId,
    }).returning();

    await db.insert(brokerEvents).values({
      brokerId: broker.id,
      eventType: "BROKER_CREATED",
      description: `Broker ${publicId} (${req.body.name}) created`,
      performedBy: req.user?.userId,
    });

    res.status(201).json({ broker });
  } catch (err: any) {
    console.error("[AdminCreateBroker]", err);
    res.status(500).json({ message: "Failed to create broker" });
  }
}

export async function adminUpdateBrokerHandler(req: AuthRequest, res: Response) {
  try {
    const brokerId = Number(req.params.id);
    const { status, ...updateData } = req.body;

    const setData: any = { ...updateData, updatedAt: new Date() };
    if (status) {
      setData.status = status;
      if (status === "ACTIVE") {
        setData.approvedAt = new Date();
        setData.approvedBy = req.user?.userId;
      }
    }

    const [updated] = await db.update(brokers)
      .set(setData)
      .where(eq(brokers.id, brokerId))
      .returning();

    if (!updated) {
      return res.status(404).json({ message: "Broker not found" });
    }

    await db.insert(brokerEvents).values({
      brokerId,
      eventType: status ? `STATUS_${status}` : "BROKER_UPDATED",
      description: status ? `Broker status changed to ${status}` : "Broker profile updated",
      performedBy: req.user?.userId,
    });

    res.json({ broker: updated });
  } catch (err: any) {
    console.error("[AdminUpdateBroker]", err);
    res.status(500).json({ message: "Failed to update broker" });
  }
}
