import { db } from "../db";
import { trips, clinicTariffs, tripBilling, patients, clinics, recurringPricingOverrides } from "@shared/schema";
import { eq, and, lte, desc, isNull } from "drizzle-orm";

interface TripRow {
  id: number;
  companyId: number | null;
  clinicId: number | null;
  patientId: number;
  cityId: number;
  scheduledDate: string;
  status: string;
  distanceMiles: string | null;
  durationMinutes: number | null;
  mobilityRequirement: string;
  passengerCount: number;
  sharedGroupId: string | null;
  sharedPassengerCount: number;
  sharedPricingMode: string;
  primaryTripId: number | null;
  cancelledReason: string | null;
  billingOutcome: string | null;
  billable: boolean;
  noShowRisk: boolean;
}

interface TariffRow {
  id: number;
  companyId: number | null;
  clinicId: number | null;
  cityId: number | null;
  name: string;
  pricingModel: string;
  baseFeeCents: number;
  perMileCents: number;
  perMinuteCents: number;
  waitMinuteCents: number;
  wheelchairExtraCents: number;
  sharedTripMode: string;
  sharedTripDiscountPct: string;
  noShowFeeCents: number;
  cancelFeeCents: number;
  minimumFareCents: number;
  currency: string;
}

interface BillingLineItem {
  tripId: number;
  companyId: number;
  clinicId: number;
  patientId: number;
  cityId: number;
  serviceDate: string;
  statusAtBill: string;
  pricingMode: string;
  tariffId: number | null;
  contractPriceCents: number | null;
  mobilityRequirement: string;
  distanceMiles: string | null;
  waitMinutes: number;
  baseFeeCents: number;
  perMileCents: number;
  mileageCents: number;
  perMinuteCents: number;
  minutesCents: number;
  waitCents: number;
  wheelchairCents: number;
  sharedPassengers: number;
  sharedDiscountCents: number;
  noShowFeeCents: number;
  cancelFeeCents: number;
  adjustmentsCents: number;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  components: Record<string, any>;
}

function determineBillStatus(trip: TripRow): string {
  const s = trip.status.toUpperCase();
  if (s === "NO_SHOW" || trip.billingOutcome === "NO_SHOW" || trip.noShowRisk) return "NO_SHOW";
  if (s === "CANCELLED" || trip.billingOutcome === "CANCELLED") return "CANCELLED";
  if (s === "COMPLETED" || s === "ARRIVED_DROPOFF") return "COMPLETED";
  return s;
}

async function findEffectiveTariff(
  companyId: number,
  clinicId: number | null,
  serviceDate: Date
): Promise<TariffRow | null> {
  if (clinicId) {
    const clinicTariff = await db
      .select()
      .from(clinicTariffs)
      .where(
        and(
          eq(clinicTariffs.companyId, companyId),
          eq(clinicTariffs.clinicId, clinicId),
          eq(clinicTariffs.active, true),
          lte(clinicTariffs.effectiveFrom, serviceDate)
        )
      )
      .orderBy(desc(clinicTariffs.effectiveFrom))
      .limit(1)
      .then((r) => r[0]);
    if (clinicTariff) return clinicTariff as TariffRow;
  }

  const companyDefault = await db
    .select()
    .from(clinicTariffs)
    .where(
      and(
        eq(clinicTariffs.companyId, companyId),
        isNull(clinicTariffs.clinicId),
        eq(clinicTariffs.active, true),
        lte(clinicTariffs.effectiveFrom, serviceDate)
      )
    )
    .orderBy(desc(clinicTariffs.effectiveFrom))
    .limit(1)
    .then((r) => r[0]);
  return companyDefault ? (companyDefault as TariffRow) : null;
}

async function findContractPrice(
  companyId: number,
  clinicId: number,
  patientId: number,
  serviceDate: string
): Promise<number | null> {
  const override = await db
    .select()
    .from(recurringPricingOverrides)
    .where(
      and(
        eq(recurringPricingOverrides.companyId, companyId),
        eq(recurringPricingOverrides.clinicId, clinicId),
        eq(recurringPricingOverrides.patientId, patientId),
        lte(recurringPricingOverrides.effectiveFrom, serviceDate)
      )
    )
    .orderBy(desc(recurringPricingOverrides.effectiveFrom))
    .limit(1)
    .then((r) => r[0]);

  if (!override) return null;
  if (override.effectiveTo && override.effectiveTo < serviceDate) return null;
  return override.priceCents;
}

function computeTariffTotal(
  tariff: TariffRow,
  miles: number,
  minutes: number,
  isWheelchair: boolean
): { baseFeeCents: number; mileageCents: number; minutesCents: number; wheelchairCents: number; subtotal: number; total: number } {
  const baseFeeCents = tariff.baseFeeCents;
  const mileageCents = Math.round(miles * tariff.perMileCents);
  const minutesCents = Math.round(minutes * tariff.perMinuteCents);
  const wheelchairCents = isWheelchair ? tariff.wheelchairExtraCents : 0;

  const subtotal = baseFeeCents + mileageCents + minutesCents + wheelchairCents;
  const total = Math.max(subtotal, tariff.minimumFareCents);
  return { baseFeeCents, mileageCents, minutesCents, wheelchairCents, subtotal, total };
}

export async function computeTripBilling(tripId: number): Promise<BillingLineItem[]> {
  const trip = await db
    .select()
    .from(trips)
    .where(eq(trips.id, tripId))
    .then((r) => r[0]) as TripRow | undefined;

  if (!trip) return [];
  if (!trip.companyId) return [];

  const companyId = trip.companyId;
  const serviceDate = trip.scheduledDate;
  const serviceDateObj = new Date(serviceDate);
  const statusAtBill = determineBillStatus(trip);

  let legTrips: TripRow[];
  if (trip.sharedGroupId) {
    legTrips = await db
      .select()
      .from(trips)
      .where(eq(trips.sharedGroupId, trip.sharedGroupId))
      .then((r) => r as TripRow[]);
  } else {
    legTrips = [trip];
  }

  const tariff = await findEffectiveTariff(companyId, trip.clinicId, serviceDateObj);

  const results: BillingLineItem[] = [];
  const sharedMode = trip.sharedPricingMode || "PER_PATIENT";
  const passengerCount = legTrips.length || 1;

  if (sharedMode === "SPLIT" && legTrips.length > 1) {
    const primaryTrip = legTrips.find((t) => t.id === trip.primaryTripId) || legTrips[0];
    const miles = primaryTrip.distanceMiles ? parseFloat(primaryTrip.distanceMiles) : 0;
    const minutes = primaryTrip.durationMinutes || 0;
    const isWheelchair = primaryTrip.mobilityRequirement !== "STANDARD";

    let routeTotal = 0;
    let tariffCalc: ReturnType<typeof computeTariffTotal> | null = null;
    const legStatus = determineBillStatus(primaryTrip);

    if (legStatus === "NO_SHOW" && tariff) {
      routeTotal = tariff.noShowFeeCents;
    } else if (legStatus === "CANCELLED" && tariff) {
      routeTotal = tariff.cancelFeeCents;
    } else if (tariff) {
      tariffCalc = computeTariffTotal(tariff, miles, minutes, isWheelchair);
      routeTotal = tariffCalc.total;
    }

    const splitBase = Math.floor(routeTotal / passengerCount);
    const remainder = routeTotal - splitBase * passengerCount;

    for (let i = 0; i < legTrips.length; i++) {
      const leg = legTrips[i];
      const legTotal = i === 0 ? splitBase + remainder : splitBase;
      const legStatusAtBill = determineBillStatus(leg);

      results.push({
        tripId: leg.id,
        companyId,
        clinicId: leg.clinicId || 0,
        patientId: leg.patientId,
        cityId: leg.cityId,
        serviceDate,
        statusAtBill: legStatusAtBill,
        pricingMode: "SPLIT",
        tariffId: tariff?.id || null,
        contractPriceCents: null,
        mobilityRequirement: leg.mobilityRequirement,
        distanceMiles: primaryTrip.distanceMiles,
        waitMinutes: 0,
        baseFeeCents: i === 0 ? (tariffCalc?.baseFeeCents || 0) : 0,
        perMileCents: tariff?.perMileCents || 0,
        mileageCents: i === 0 ? (tariffCalc?.mileageCents || 0) : 0,
        perMinuteCents: tariff?.perMinuteCents || 0,
        minutesCents: i === 0 ? (tariffCalc?.minutesCents || 0) : 0,
        waitCents: 0,
        wheelchairCents: i === 0 ? (tariffCalc?.wheelchairCents || 0) : 0,
        sharedPassengers: passengerCount,
        sharedDiscountCents: routeTotal - legTotal,
        noShowFeeCents: legStatusAtBill === "NO_SHOW" ? (tariff?.noShowFeeCents || 0) : 0,
        cancelFeeCents: legStatusAtBill === "CANCELLED" ? (tariff?.cancelFeeCents || 0) : 0,
        adjustmentsCents: 0,
        subtotalCents: legTotal,
        totalCents: legTotal,
        currency: tariff?.currency || "USD",
        components: {
          mode: "SPLIT",
          route_total_cents: routeTotal,
          passenger_count: passengerCount,
          split_base: splitBase,
          remainder,
          leg_index: i,
          tariff_snapshot: tariff ? { id: tariff.id, name: tariff.name, baseFeeCents: tariff.baseFeeCents, perMileCents: tariff.perMileCents, perMinuteCents: tariff.perMinuteCents, wheelchairExtraCents: tariff.wheelchairExtraCents, minimumFareCents: tariff.minimumFareCents, noShowFeeCents: tariff.noShowFeeCents, cancelFeeCents: tariff.cancelFeeCents } : null,
          miles,
          minutes,
          status_at_bill: legStatusAtBill,
        },
      });
    }
  } else {
    for (const leg of legTrips) {
      const legStatus = determineBillStatus(leg);
      const miles = leg.distanceMiles ? parseFloat(leg.distanceMiles) : 0;
      const minutes = leg.durationMinutes || 0;
      const isWheelchair = leg.mobilityRequirement !== "STANDARD";

      const contractPrice = leg.clinicId
        ? await findContractPrice(companyId, leg.clinicId, leg.patientId, serviceDate)
        : null;

      let pricingMode = "TARIFF";
      let totalCents = 0;
      let baseFeeCents = 0;
      let mileageCents = 0;
      let minutesCentsVal = 0;
      let wheelchairCents = 0;
      let noShowFee = 0;
      let cancelFee = 0;
      let subtotal = 0;
      let contractPriceCents: number | null = null;

      if (legStatus === "NO_SHOW") {
        noShowFee = tariff?.noShowFeeCents || 0;
        totalCents = noShowFee;
        subtotal = noShowFee;
      } else if (legStatus === "CANCELLED") {
        cancelFee = tariff?.cancelFeeCents || 0;
        totalCents = cancelFee;
        subtotal = cancelFee;
      } else if (contractPrice !== null) {
        pricingMode = "CONTRACT";
        contractPriceCents = contractPrice;
        totalCents = contractPrice;
        subtotal = contractPrice;
      } else if (tariff) {
        const calc = computeTariffTotal(tariff, miles, minutes, isWheelchair);
        baseFeeCents = calc.baseFeeCents;
        mileageCents = calc.mileageCents;
        minutesCentsVal = calc.minutesCents;
        wheelchairCents = calc.wheelchairCents;
        subtotal = calc.subtotal;
        totalCents = calc.total;
      }

      const discountPct = tariff ? parseFloat(tariff.sharedTripDiscountPct) : 0;
      let sharedDiscountCents = 0;
      if (sharedMode === "PER_PATIENT" && passengerCount > 1 && discountPct > 0 && legStatus === "COMPLETED") {
        sharedDiscountCents = Math.round(totalCents * discountPct / 100);
        totalCents -= sharedDiscountCents;
      }

      results.push({
        tripId: leg.id,
        companyId,
        clinicId: leg.clinicId || 0,
        patientId: leg.patientId,
        cityId: leg.cityId,
        serviceDate,
        statusAtBill: legStatus,
        pricingMode,
        tariffId: tariff?.id || null,
        contractPriceCents,
        mobilityRequirement: leg.mobilityRequirement,
        distanceMiles: leg.distanceMiles,
        waitMinutes: 0,
        baseFeeCents,
        perMileCents: tariff?.perMileCents || 0,
        mileageCents,
        perMinuteCents: tariff?.perMinuteCents || 0,
        minutesCents: minutesCentsVal,
        waitCents: 0,
        wheelchairCents,
        sharedPassengers: passengerCount,
        sharedDiscountCents,
        noShowFeeCents: noShowFee,
        cancelFeeCents: cancelFee,
        adjustmentsCents: 0,
        subtotalCents: subtotal,
        totalCents,
        currency: tariff?.currency || "USD",
        components: {
          mode: pricingMode,
          tariff_snapshot: tariff ? { id: tariff.id, name: tariff.name, baseFeeCents: tariff.baseFeeCents, perMileCents: tariff.perMileCents, perMinuteCents: tariff.perMinuteCents, wheelchairExtraCents: tariff.wheelchairExtraCents, minimumFareCents: tariff.minimumFareCents, noShowFeeCents: tariff.noShowFeeCents, cancelFeeCents: tariff.cancelFeeCents } : null,
          miles,
          minutes,
          is_wheelchair: isWheelchair,
          passenger_count: passengerCount,
          shared_discount_pct: discountPct,
          shared_discount_cents: sharedDiscountCents,
          contract_price_cents: contractPriceCents,
          status_at_bill: legStatus,
          cancel_reason: leg.cancelledReason,
        },
      });
    }
  }

  return results;
}

export async function upsertTripBillingRows(lines: BillingLineItem[]): Promise<void> {
  for (const line of lines) {
    const existing = await db
      .select({ id: tripBilling.id })
      .from(tripBilling)
      .where(
        and(
          eq(tripBilling.tripId, line.tripId),
          eq(tripBilling.patientId, line.patientId)
        )
      )
      .then((r) => r[0]);

    if (existing) {
      await db
        .update(tripBilling)
        .set({
          companyId: line.companyId,
          clinicId: line.clinicId,
          serviceDate: line.serviceDate,
          statusAtBill: line.statusAtBill,
          pricingMode: line.pricingMode,
          tariffId: line.tariffId,
          contractPriceCents: line.contractPriceCents,
          mobilityRequirement: line.mobilityRequirement,
          distanceMiles: line.distanceMiles,
          waitMinutes: line.waitMinutes,
          baseFeeCents: line.baseFeeCents,
          perMileCents: line.perMileCents,
          mileageCents: line.mileageCents,
          perMinuteCents: line.perMinuteCents,
          minutesCents: line.minutesCents,
          waitCents: line.waitCents,
          wheelchairCents: line.wheelchairCents,
          sharedPassengers: line.sharedPassengers,
          sharedDiscountCents: line.sharedDiscountCents,
          noShowFeeCents: line.noShowFeeCents,
          cancelFeeCents: line.cancelFeeCents,
          adjustmentsCents: line.adjustmentsCents,
          subtotalCents: line.subtotalCents,
          totalCents: line.totalCents,
          currency: line.currency,
          components: line.components,
          updatedAt: new Date(),
        })
        .where(eq(tripBilling.id, existing.id));
    } else {
      await db.insert(tripBilling).values({
        tripId: line.tripId,
        companyId: line.companyId,
        clinicId: line.clinicId,
        patientId: line.patientId,
        cityId: line.cityId,
        serviceDate: line.serviceDate,
        statusAtBill: line.statusAtBill,
        pricingMode: line.pricingMode,
        tariffId: line.tariffId,
        contractPriceCents: line.contractPriceCents,
        mobilityRequirement: line.mobilityRequirement,
        distanceMiles: line.distanceMiles,
        waitMinutes: line.waitMinutes,
        baseFeeCents: line.baseFeeCents,
        perMileCents: line.perMileCents,
        mileageCents: line.mileageCents,
        perMinuteCents: line.perMinuteCents,
        minutesCents: line.minutesCents,
        waitCents: line.waitCents,
        wheelchairCents: line.wheelchairCents,
        sharedPassengers: line.sharedPassengers,
        sharedDiscountCents: line.sharedDiscountCents,
        noShowFeeCents: line.noShowFeeCents,
        cancelFeeCents: line.cancelFeeCents,
        adjustmentsCents: line.adjustmentsCents,
        subtotalCents: line.subtotalCents,
        totalCents: line.totalCents,
        currency: line.currency,
        components: line.components,
        status: "computed",
      });
    }
  }
}
