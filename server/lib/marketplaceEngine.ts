/**
 * Marketplace Engine — Handles broker trip matching, bidding logic, auto-award,
 * settlement generation, and performance tracking.
 */
import { db } from "../db";
import {
  brokerTripRequests,
  brokerBids,
  brokerContracts,
  brokerSettlements,
  brokerSettlementItems,
  brokerEvents,
  brokerPerformanceMetrics,
  brokerRateCards,
  companies,
  trips,
} from "@shared/schema";
import { eq, and, sql, desc, asc, count, avg, sum, inArray, lte, gte } from "drizzle-orm";

// ─── Public ID Generator ──────────────────────────────────────────────────────

function generateBrokerId(prefix: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = prefix;
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export function generateBrokerPublicId(): string {
  return generateBrokerId("BRK-");
}

export function generateContractPublicId(): string {
  return generateBrokerId("CTR-");
}

export function generateTripRequestPublicId(): string {
  return generateBrokerId("BTR-");
}

export function generateSettlementPublicId(): string {
  return generateBrokerId("STL-");
}

// ─── Auto-Award Engine ────────────────────────────────────────────────────────

export interface AwardResult {
  awarded: boolean;
  bidId?: number;
  companyId?: number;
  reason: string;
}

export async function evaluateAutoAward(tripRequestId: number): Promise<AwardResult> {
  const [request] = await db.select()
    .from(brokerTripRequests)
    .where(eq(brokerTripRequests.id, tripRequestId))
    .limit(1);

  if (!request || request.status !== "BIDDING") {
    return { awarded: false, reason: "Request not in bidding state" };
  }

  // Get all pending bids
  const bids = await db.select()
    .from(brokerBids)
    .where(and(
      eq(brokerBids.tripRequestId, tripRequestId),
      eq(brokerBids.status, "PENDING"),
    ))
    .orderBy(asc(brokerBids.bidAmount));

  if (bids.length === 0) {
    return { awarded: false, reason: "No bids received" };
  }

  const minBids = request.minBids ?? 1;
  if (bids.length < minBids) {
    return { awarded: false, reason: `Waiting for minimum ${minBids} bids (have ${bids.length})` };
  }

  // Score bids: 60% price, 25% company rating, 15% SLA guarantee
  const maxAmount = Math.max(...bids.map(b => Number(b.bidAmount)));
  const scoredBids = bids.map(bid => {
    const priceScore = maxAmount > 0 ? (1 - Number(bid.bidAmount) / maxAmount) * 60 : 30;
    const ratingScore = (bid.companyRating ?? 3) / 5 * 25;
    const slaScore = bid.slaGuarantee ? 15 : 0;
    return { ...bid, score: priceScore + ratingScore + slaScore };
  });

  scoredBids.sort((a, b) => b.score - a.score);
  const winner = scoredBids[0];

  // Check budget constraint
  if (request.maxBudget && Number(winner.bidAmount) > Number(request.maxBudget)) {
    return { awarded: false, reason: "All bids exceed maximum budget" };
  }

  // Award the bid
  await db.update(brokerBids)
    .set({ status: "ACCEPTED", respondedAt: new Date() })
    .where(eq(brokerBids.id, winner.id));

  // Reject other bids
  const otherBidIds = scoredBids.filter(b => b.id !== winner.id).map(b => b.id);
  if (otherBidIds.length > 0) {
    await db.update(brokerBids)
      .set({ status: "REJECTED", respondedAt: new Date() })
      .where(inArray(brokerBids.id, otherBidIds));
  }

  // Update trip request
  await db.update(brokerTripRequests)
    .set({
      status: "AWARDED",
      awardedCompanyId: winner.companyId,
      awardedBidId: winner.id,
      awardedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(brokerTripRequests.id, tripRequestId));

  // Log event
  await db.insert(brokerEvents).values({
    tripRequestId,
    bidId: winner.id,
    brokerId: request.brokerId,
    eventType: "BID_AUTO_AWARDED",
    description: `Auto-awarded to company ${winner.companyId} for $${winner.bidAmount}`,
    metadata: { score: winner.score, totalBids: bids.length },
  });

  return {
    awarded: true,
    bidId: winner.id,
    companyId: winner.companyId,
    reason: `Awarded to highest-scoring bid ($${winner.bidAmount})`,
  };
}

// ─── Rate Card Pricing ────────────────────────────────────────────────────────

export async function calculateRateCardPrice(
  contractId: number,
  serviceType: string,
  miles: number,
  minutes?: number,
): Promise<{ amount: number; rateCardId: number } | null> {
  const today = new Date().toISOString().split("T")[0];

  const [card] = await db.select()
    .from(brokerRateCards)
    .where(and(
      eq(brokerRateCards.contractId, contractId),
      eq(brokerRateCards.serviceType, serviceType),
      eq(brokerRateCards.isActive, true),
      lte(brokerRateCards.effectiveDate, today),
    ))
    .orderBy(desc(brokerRateCards.effectiveDate))
    .limit(1);

  if (!card) return null;

  let amount = Number(card.baseFare);
  amount += miles * Number(card.perMileRate);
  if (minutes && card.perMinuteRate) {
    amount += minutes * Number(card.perMinuteRate);
  }

  if (card.minimumFare && amount < Number(card.minimumFare)) {
    amount = Number(card.minimumFare);
  }
  if (card.maximumFare && amount > Number(card.maximumFare)) {
    amount = Number(card.maximumFare);
  }

  return { amount: Math.round(amount * 100) / 100, rateCardId: card.id };
}

// ─── Settlement Generator ─────────────────────────────────────────────────────

export async function generateSettlement(
  brokerId: number,
  companyId: number,
  periodStart: string,
  periodEnd: string,
  userId?: number,
): Promise<{ settlementId: number; totalTrips: number; grossAmount: number }> {
  // Find all completed trip requests for this broker+company in the period
  const completedRequests = await db.select()
    .from(brokerTripRequests)
    .where(and(
      eq(brokerTripRequests.brokerId, brokerId),
      eq(brokerTripRequests.awardedCompanyId, companyId),
      eq(brokerTripRequests.status, "COMPLETED"),
      gte(brokerTripRequests.requestedDate, periodStart),
      lte(brokerTripRequests.requestedDate, periodEnd),
    ));

  // Get awarded bids for pricing
  const bidIds = completedRequests.filter(r => r.awardedBidId).map(r => r.awardedBidId!);
  const awardedBids = bidIds.length > 0
    ? await db.select().from(brokerBids).where(inArray(brokerBids.id, bidIds))
    : [];
  const bidMap = new Map(awardedBids.map(b => [b.id, b]));

  let grossAmount = 0;
  let totalMiles = 0;
  const lineItems: any[] = [];

  for (const req of completedRequests) {
    const bid = req.awardedBidId ? bidMap.get(req.awardedBidId) : null;
    const amount = bid ? Number(bid.bidAmount) : 0;
    grossAmount += amount;
    totalMiles += req.estimatedMiles ?? 0;

    lineItems.push({
      tripRequestId: req.id,
      tripId: req.tripId,
      serviceDate: req.requestedDate,
      memberName: req.memberName,
      memberId: req.memberId,
      pickupAddress: req.pickupAddress,
      dropoffAddress: req.dropoffAddress,
      miles: req.estimatedMiles,
      amount: amount.toFixed(2),
    });
  }

  const platformFee = grossAmount * 0.05; // 5% platform fee
  const netAmount = grossAmount - platformFee;

  const publicId = generateSettlementPublicId();
  const [settlement] = await db.insert(brokerSettlements).values({
    publicId,
    brokerId,
    companyId,
    status: "PENDING",
    periodStart,
    periodEnd,
    totalTrips: completedRequests.length,
    totalMiles,
    grossAmount: grossAmount.toFixed(2),
    platformFee: platformFee.toFixed(2),
    netAmount: netAmount.toFixed(2),
    dueDate: calculateDueDate(periodEnd, 30),
    createdBy: userId,
  }).returning();

  // Insert line items
  if (lineItems.length > 0) {
    await db.insert(brokerSettlementItems).values(
      lineItems.map(item => ({ ...item, settlementId: settlement.id })),
    );
  }

  await db.insert(brokerEvents).values({
    brokerId,
    settlementId: settlement.id,
    eventType: "SETTLEMENT_GENERATED",
    description: `Settlement ${publicId}: ${completedRequests.length} trips, $${grossAmount.toFixed(2)} gross`,
    performedBy: userId,
  });

  return {
    settlementId: settlement.id,
    totalTrips: completedRequests.length,
    grossAmount,
  };
}

function calculateDueDate(periodEnd: string, days: number): string {
  const date = new Date(periodEnd);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}

// ─── Performance Metrics Rollup ───────────────────────────────────────────────

export async function rollupBrokerMetrics(brokerId: number, period: string): Promise<void> {
  const [year, month] = period.split("-");
  const periodStart = `${year}-${month}-01`;
  const nextMonth = Number(month) === 12 ? `${Number(year) + 1}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, "0")}-01`;

  const requests = await db.select()
    .from(brokerTripRequests)
    .where(and(
      eq(brokerTripRequests.brokerId, brokerId),
      gte(brokerTripRequests.requestedDate, periodStart),
      sql`${brokerTripRequests.requestedDate} < ${nextMonth}`,
    ));

  const totalRequests = requests.length;
  const totalAwarded = requests.filter(r => r.status === "AWARDED" || r.status === "COMPLETED" || r.status === "IN_PROGRESS").length;
  const totalCompleted = requests.filter(r => r.status === "COMPLETED").length;
  const totalCancelled = requests.filter(r => r.status === "CANCELLED").length;
  const totalDisputed = requests.filter(r => r.status === "DISPUTED").length;

  // Get bid stats
  const requestIds = requests.map(r => r.id);
  let avgBidAmount = null;
  let avgAwardedAmount = null;

  if (requestIds.length > 0) {
    const [bidStats] = await db.select({
      avgBid: avg(brokerBids.bidAmount),
    })
      .from(brokerBids)
      .where(inArray(brokerBids.tripRequestId, requestIds));

    avgBidAmount = bidStats?.avgBid ?? null;

    const [awardedStats] = await db.select({
      avgAwarded: avg(brokerBids.bidAmount),
    })
      .from(brokerBids)
      .where(and(
        inArray(brokerBids.tripRequestId, requestIds),
        eq(brokerBids.status, "ACCEPTED"),
      ));

    avgAwardedAmount = awardedStats?.avgAwarded ?? null;
  }

  // Upsert metrics
  await db.insert(brokerPerformanceMetrics).values({
    brokerId,
    period,
    totalRequests,
    totalAwarded,
    totalCompleted,
    totalCancelled,
    totalDisputed,
    avgBidAmount,
    avgAwardedAmount,
  });
}
