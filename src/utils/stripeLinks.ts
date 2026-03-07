const STRIPE_DASHBOARD_BASE = "https://dashboard.stripe.com";

export function stripeDashboardUrl(resource: string, id: string, testMode: boolean = false): string {
  const prefix = testMode ? `${STRIPE_DASHBOARD_BASE}/test` : STRIPE_DASHBOARD_BASE;

  switch (resource) {
    case "payment_intent":
      return `${prefix}/payments/${id}`;
    case "invoice":
      return `${prefix}/invoices/${id}`;
    case "customer":
      return `${prefix}/customers/${id}`;
    case "subscription":
      return `${prefix}/subscriptions/${id}`;
    case "connect_account":
      return `${prefix}/connect/accounts/${id}`;
    case "payout":
      return `${prefix}/payouts/${id}`;
    default:
      return `${prefix}/${resource}/${id}`;
  }
}

export function isTestMode(): boolean {
  const key = process.env.STRIPE_SECRET_KEY || "";
  return key.startsWith("sk_test_");
}
