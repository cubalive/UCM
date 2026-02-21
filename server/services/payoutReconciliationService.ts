import { db } from "../db";
import { payoutReconciliation, companies } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { storage } from "../storage";

function getStripe() {
  const Stripe = require("stripe").default;
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function reconcileCompanyPayouts(companyId: number): Promise<{ inserted: number; skipped: number }> {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn("[Reconciliation] Stripe not configured");
    return { inserted: 0, skipped: 0 };
  }

  const stripeAccount = await storage.getCompanyStripeAccount(companyId);
  if (!stripeAccount?.stripeAccountId) {
    console.warn(`[Reconciliation] No stripe account for company ${companyId}`);
    return { inserted: 0, skipped: 0 };
  }

  const stripe = getStripe();
  let inserted = 0;
  let skipped = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: any = {
      limit: 100,
    };
    if (startingAfter) params.starting_after = startingAfter;

    const txns = await stripe.balanceTransactions.list(params, {
      stripeAccount: stripeAccount.stripeAccountId,
    });

    for (const txn of txns.data) {
      try {
        await db.insert(payoutReconciliation).values({
          companyId,
          stripeAccountId: stripeAccount.stripeAccountId,
          stripeBalanceTransactionId: txn.id,
          stripeTransferId: txn.source?.startsWith("tr_") ? txn.source : null,
          stripePayoutId: txn.type === "payout" ? txn.source : null,
          stripeChargeId: txn.source?.startsWith("ch_") || txn.source?.startsWith("py_") ? txn.source : null,
          amountCents: txn.amount,
          feeCents: txn.fee,
          netCents: txn.net,
          currency: txn.currency,
          type: txn.type,
          status: txn.status,
          availableOn: txn.available_on ? new Date(txn.available_on * 1000) : null,
        });
        inserted++;
      } catch (err: any) {
        if (err.message?.includes("duplicate key") || err.code === "23505") {
          skipped++;
        } else {
          console.error(`[Reconciliation] Insert error for ${txn.id}:`, err.message);
        }
      }
    }

    hasMore = txns.has_more;
    if (txns.data.length > 0) {
      startingAfter = txns.data[txns.data.length - 1].id;
    }
  }

  console.log(`[Reconciliation] Company ${companyId}: inserted=${inserted}, skipped=${skipped}`);
  return { inserted, skipped };
}
