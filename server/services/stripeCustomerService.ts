import { db } from "../db";
import { clinics } from "@shared/schema";
import { eq } from "drizzle-orm";

function getStripe() {
  const Stripe = require("stripe").default;
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function ensureClinicStripeCustomer(clinicId: number): Promise<string> {
  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId));
  if (!clinic) throw new Error(`Clinic ${clinicId} not found`);

  if (clinic.stripeCustomerId) return clinic.stripeCustomerId;

  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe not configured");
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: clinic.name,
    email: clinic.email || undefined,
    metadata: {
      ucm_clinic_id: String(clinicId),
      ucm_company_id: clinic.companyId ? String(clinic.companyId) : "",
    },
  });

  await db.update(clinics).set({
    stripeCustomerId: customer.id,
  }).where(eq(clinics.id, clinicId));

  console.log(`[StripeCustomer] Created customer ${customer.id} for clinic ${clinicId}`);
  return customer.id;
}

export async function getClinicPaymentMethods(clinicId: number): Promise<any[]> {
  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId));
  if (!clinic?.stripeCustomerId || !process.env.STRIPE_SECRET_KEY) return [];

  const stripe = getStripe();
  const methods = await stripe.paymentMethods.list({
    customer: clinic.stripeCustomerId,
    type: "card",
  });

  return methods.data.map((pm: any) => ({
    id: pm.id,
    brand: pm.card?.brand,
    last4: pm.card?.last4,
    expMonth: pm.card?.exp_month,
    expYear: pm.card?.exp_year,
    isDefault: pm.id === clinic.stripeDefaultPaymentMethodId,
  }));
}

export async function setDefaultPaymentMethod(clinicId: number, paymentMethodId: string): Promise<void> {
  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId));
  if (!clinic?.stripeCustomerId || !process.env.STRIPE_SECRET_KEY) {
    throw new Error("Clinic or Stripe not configured");
  }

  const stripe = getStripe();
  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: clinic.stripeCustomerId,
  }).catch(() => {});

  await stripe.customers.update(clinic.stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  await db.update(clinics).set({
    stripeDefaultPaymentMethodId: paymentMethodId,
  }).where(eq(clinics.id, clinicId));
}

export async function detachPaymentMethod(clinicId: number, paymentMethodId: string): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");

  const stripe = getStripe();
  await stripe.paymentMethods.detach(paymentMethodId);

  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId));
  if (clinic?.stripeDefaultPaymentMethodId === paymentMethodId) {
    await db.update(clinics).set({
      stripeDefaultPaymentMethodId: null,
    }).where(eq(clinics.id, clinicId));
  }
}

export async function createSetupIntent(clinicId: number): Promise<{ clientSecret: string }> {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");

  const customerId = await ensureClinicStripeCustomer(clinicId);
  const stripe = getStripe();

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    metadata: { ucm_clinic_id: String(clinicId) },
  });

  return { clientSecret: setupIntent.client_secret };
}
