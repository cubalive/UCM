import { db } from "../db";
import { pharmacyOrders, pharmacyOrderEvents, drivers, patients } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendPushToDriver, type PushPayload } from "./push";
import { sendSms } from "./twilioSms";

// ─── Status Display Labels ───────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PREPARING: "Being Prepared",
  READY_FOR_PICKUP: "Ready for Pickup",
  DRIVER_ASSIGNED: "Driver Assigned",
  EN_ROUTE_PICKUP: "Driver En Route to Pharmacy",
  PICKED_UP: "Picked Up",
  EN_ROUTE_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  FAILED: "Delivery Failed",
  CANCELLED: "Cancelled",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

// ─── Notify Pharmacy Order Update (Push to Driver) ───────────────────────────

export async function notifyPharmacyOrderUpdate(
  orderId: number,
  status: string,
): Promise<{ driverNotified: boolean }> {
  try {
    const [order] = await db
      .select()
      .from(pharmacyOrders)
      .where(eq(pharmacyOrders.id, orderId))
      .limit(1);

    if (!order) {
      console.warn(`[PharmacyNotify] Order ${orderId} not found`);
      return { driverNotified: false };
    }

    if (!order.driverId) {
      console.log(`[PharmacyNotify] Order ${orderId} has no driver assigned, skipping push`);
      return { driverNotified: false };
    }

    const payload: PushPayload = buildDriverPushPayload(order, status);
    const result = await sendPushToDriver(order.driverId, payload);

    console.log(
      `[PharmacyNotify] Order ${orderId} status=${status} driver=${order.driverId} sent=${result.sent}`,
    );

    return { driverNotified: result.sent > 0 };
  } catch (err: any) {
    console.error(`[PharmacyNotify] Failed to notify order ${orderId}: ${err.message}`);
    return { driverNotified: false };
  }
}

function buildDriverPushPayload(
  order: { publicId: string; deliveryAddress: string; priority: string; isControlledSubstance: boolean },
  status: string,
): PushPayload {
  const label = statusLabel(status);

  if (status === "READY_FOR_PICKUP") {
    const urgent = order.priority === "STAT" || order.priority === "URGENT";
    return {
      title: urgent ? "URGENT: Pharmacy Pickup Ready" : "Pharmacy Pickup Ready",
      body: `Order ${order.publicId} is ready for pickup. Deliver to: ${order.deliveryAddress}`,
      data: {
        type: "pharmacy_order",
        orderId: String(order.publicId),
        status,
        priority: order.priority,
        isControlled: String(order.isControlledSubstance),
      },
    };
  }

  if (status === "CANCELLED") {
    return {
      title: "Pharmacy Delivery Cancelled",
      body: `Order ${order.publicId} has been cancelled.`,
      data: {
        type: "pharmacy_order",
        orderId: String(order.publicId),
        status,
      },
    };
  }

  return {
    title: `Pharmacy Order Update`,
    body: `Order ${order.publicId}: ${label}`,
    data: {
      type: "pharmacy_order",
      orderId: String(order.publicId),
      status,
    },
  };
}

// ─── Notify Urgent Delivery (Escalation) ─────────────────────────────────────

export async function notifyUrgentDelivery(
  orderId: number,
): Promise<{ driverNotified: boolean; escalated: boolean }> {
  try {
    const [order] = await db
      .select()
      .from(pharmacyOrders)
      .where(eq(pharmacyOrders.id, orderId))
      .limit(1);

    if (!order) {
      console.warn(`[PharmacyUrgent] Order ${orderId} not found`);
      return { driverNotified: false, escalated: false };
    }

    let driverNotified = false;

    // Push notification to driver if assigned
    if (order.driverId) {
      const payload: PushPayload = {
        title: "URGENT: Delivery Overdue",
        body: `Order ${order.publicId} is overdue! Priority: ${order.priority}. Deliver to: ${order.deliveryAddress}`,
        data: {
          type: "pharmacy_urgent",
          orderId: String(order.publicId),
          priority: order.priority,
          isControlled: String(order.isControlledSubstance),
        },
      };

      const result = await sendPushToDriver(order.driverId, payload);
      driverNotified = result.sent > 0;
    }

    // Log escalation event
    await db.insert(pharmacyOrderEvents).values({
      orderId,
      eventType: "URGENT_ESCALATION",
      description: `Order ${order.publicId} flagged as urgent/overdue. Priority: ${order.priority}`,
      metadata: {
        priority: order.priority,
        driverAssigned: !!order.driverId,
        driverNotified,
        escalatedAt: new Date().toISOString(),
      },
    });

    console.log(
      `[PharmacyUrgent] Order ${orderId} escalated. driverNotified=${driverNotified}`,
    );

    return { driverNotified, escalated: true };
  } catch (err: any) {
    console.error(`[PharmacyUrgent] Failed to escalate order ${orderId}: ${err.message}`);
    return { driverNotified: false, escalated: false };
  }
}

// ─── Notify Patient Delivery Update (SMS) ────────────────────────────────────

export async function notifyPatientDeliveryUpdate(
  orderId: number,
  status: string,
): Promise<{ smsSent: boolean }> {
  try {
    const [order] = await db
      .select()
      .from(pharmacyOrders)
      .where(eq(pharmacyOrders.id, orderId))
      .limit(1);

    if (!order) {
      console.warn(`[PharmacyPatientSms] Order ${orderId} not found`);
      return { smsSent: false };
    }

    // Determine recipient phone: use order recipientPhone or look up patient
    let phone = order.recipientPhone;
    if (!phone && order.patientId) {
      const [patient] = await db
        .select({ phone: patients.phone })
        .from(patients)
        .where(eq(patients.id, order.patientId))
        .limit(1);
      phone = patient?.phone || null;
    }

    if (!phone) {
      console.log(`[PharmacyPatientSms] No phone for order ${orderId}, skipping SMS`);
      return { smsSent: false };
    }

    const message = buildPatientSmsMessage(order, status);
    const result = await sendSms(phone, message);

    if (result.success) {
      // Log SMS event
      await db.insert(pharmacyOrderEvents).values({
        orderId,
        eventType: "PATIENT_SMS_SENT",
        description: `SMS sent to patient: ${statusLabel(status)}`,
        metadata: {
          status,
          phoneLast4: phone.slice(-4),
          sid: result.sid,
        },
      });
    }

    console.log(
      `[PharmacyPatientSms] Order ${orderId} status=${status} smsSent=${result.success}`,
    );

    return { smsSent: result.success };
  } catch (err: any) {
    console.error(`[PharmacyPatientSms] Failed for order ${orderId}: ${err.message}`);
    return { smsSent: false };
  }
}

const PREFIX = "United Care Mobility:";
const OPT_OUT = "\nReply STOP to opt out.";

function trackingUrl(publicId: string): string {
  const base = process.env.APP_URL || "https://app.unitedcaremobility.com";
  return `${base}/track/${publicId}`;
}

function buildPatientSmsMessage(
  order: { publicId: string; recipientName: string; deliveryAddress: string },
  status: string,
  options?: { etaMinutes?: number; driverName?: string },
): string {
  const track = trackingUrl(order.publicId);
  const etaText = options?.etaMinutes ? ` ETA: ~${options.etaMinutes} min.` : "";
  const driverText = options?.driverName ? ` Driver: ${options.driverName}.` : "";

  switch (status) {
    case "CONFIRMED":
      return `${PREFIX} Hi ${order.recipientName}, your pharmacy delivery (${order.publicId}) has been confirmed and is being prepared. Track: ${track}${OPT_OUT}`;
    case "READY_FOR_PICKUP":
      return `${PREFIX} Your medication order (${order.publicId}) is ready and a driver will be assigned shortly. Track: ${track}${OPT_OUT}`;
    case "DRIVER_ASSIGNED":
      return `${PREFIX} A driver has been assigned to deliver your medication (${order.publicId}).${driverText} Track: ${track}${OPT_OUT}`;
    case "EN_ROUTE_PICKUP":
      return `${PREFIX} Your driver is heading to the pharmacy to pick up your medication (${order.publicId}).${driverText}${etaText} Track: ${track}${OPT_OUT}`;
    case "PICKED_UP":
      return `${PREFIX} Your medication (${order.publicId}) has been picked up from the pharmacy and will be delivered soon.${etaText} Track: ${track}${OPT_OUT}`;
    case "EN_ROUTE_DELIVERY":
      return `${PREFIX} Your medication (${order.publicId}) is on the way!${etaText}${driverText} Track: ${track}${OPT_OUT}`;
    case "ARRIVING_SOON":
      return `${PREFIX} Your medication (${order.publicId}) is arriving in ~${options?.etaMinutes || 5} minutes! Please be ready.${driverText} Track: ${track}${OPT_OUT}`;
    case "DELIVERED":
      return `${PREFIX} Your medication (${order.publicId}) has been delivered to ${order.deliveryAddress}. Thank you!${OPT_OUT}`;
    case "FAILED":
      return `${PREFIX} We were unable to complete delivery of your medication (${order.publicId}). Please contact your pharmacy for assistance.${OPT_OUT}`;
    case "CANCELLED":
      return `${PREFIX} Your medication delivery (${order.publicId}) has been cancelled. Contact your pharmacy for more information.${OPT_OUT}`;
    default:
      return `${PREFIX} Update on your pharmacy delivery (${order.publicId}): ${statusLabel(status)}. Track: ${track}${OPT_OUT}`;
  }
}

// ─── Enhanced Patient Notification with ETA and Driver Info ───────────────────

export async function notifyPatientDeliveryUpdateEnhanced(
  orderId: number,
  status: string,
  options?: { etaMinutes?: number },
): Promise<{ smsSent: boolean }> {
  try {
    const [order] = await db.select().from(pharmacyOrders).where(eq(pharmacyOrders.id, orderId)).limit(1);
    if (!order) return { smsSent: false };

    let phone = order.recipientPhone;
    if (!phone && order.patientId) {
      const [patient] = await db.select({ phone: patients.phone }).from(patients).where(eq(patients.id, order.patientId)).limit(1);
      phone = patient?.phone || null;
    }
    if (!phone) return { smsSent: false };

    let driverName: string | undefined;
    if (order.driverId) {
      const [driver] = await db.select({ firstName: drivers.firstName, lastName: drivers.lastName }).from(drivers).where(eq(drivers.id, order.driverId)).limit(1);
      if (driver) driverName = `${driver.firstName} ${driver.lastName?.charAt(0) || ""}.`;
    }

    const message = buildPatientSmsMessage(order, status, { etaMinutes: options?.etaMinutes, driverName });
    const result = await sendSms(phone, message);

    if (result.success) {
      await db.insert(pharmacyOrderEvents).values({
        orderId, eventType: "PATIENT_SMS_SENT",
        description: `SMS sent to patient: ${statusLabel(status)}${options?.etaMinutes ? ` (ETA: ${options.etaMinutes}min)` : ""}`,
        metadata: { status, phoneLast4: phone.slice(-4), sid: result.sid, etaMinutes: options?.etaMinutes, driverName },
      });
    }

    return { smsSent: result.success };
  } catch (err: any) {
    console.error(`[PharmacyPatientSms] Enhanced notify failed for order ${orderId}: ${err.message}`);
    return { smsSent: false };
  }
}

// ─── Arriving Soon Notification ──────────────────────────────────────────────

export async function notifyPatientArrivingSoon(
  orderId: number,
  etaMinutes: number,
): Promise<{ smsSent: boolean }> {
  return notifyPatientDeliveryUpdateEnhanced(orderId, "ARRIVING_SOON", { etaMinutes });
}
