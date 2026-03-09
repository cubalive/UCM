import { describe, it, expect } from "vitest";
import { stripeDashboardUrl } from "../../src/utils/stripeLinks.js";

describe("Stripe Dashboard Deep Links", () => {
  it("generates payment intent link", () => {
    const url = stripeDashboardUrl("payment_intent", "pi_123");
    expect(url).toBe("https://dashboard.stripe.com/payments/pi_123");
  });

  it("generates test mode payment intent link", () => {
    const url = stripeDashboardUrl("payment_intent", "pi_123", true);
    expect(url).toBe("https://dashboard.stripe.com/test/payments/pi_123");
  });

  it("generates invoice link", () => {
    const url = stripeDashboardUrl("invoice", "in_abc");
    expect(url).toBe("https://dashboard.stripe.com/invoices/in_abc");
  });

  it("generates customer link", () => {
    const url = stripeDashboardUrl("customer", "cus_xyz");
    expect(url).toBe("https://dashboard.stripe.com/customers/cus_xyz");
  });

  it("generates connect account link", () => {
    const url = stripeDashboardUrl("connect_account", "acct_123");
    expect(url).toBe("https://dashboard.stripe.com/connect/accounts/acct_123");
  });

  it("handles unknown resource types gracefully", () => {
    const url = stripeDashboardUrl("refund", "re_123");
    expect(url).toBe("https://dashboard.stripe.com/refund/re_123");
  });
});
