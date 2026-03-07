import Stripe from "stripe";
import logger from "./logger.js";

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is required");
    stripeInstance = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
  }
  return stripeInstance;
}

export async function checkStripeHealth(): Promise<{ connected: boolean; latencyMs?: number }> {
  try {
    const start = Date.now();
    await getStripe().balance.retrieve();
    return { connected: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    logger.warn("Stripe health check failed", { error: err.message });
    return { connected: false };
  }
}
