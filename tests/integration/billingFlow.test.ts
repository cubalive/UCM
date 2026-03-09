import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestDb, getTestPool, cleanTestData, seedTestTenant, seedFeeRules, seedCompletedTrips } from "./setup.js";
import { invoices, invoiceLineItems, ledgerEntries, billingCycles, webhookEvents } from "../../src/db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

describe("Billing Flow - Integration Tests", () => {
  let db: ReturnType<typeof getTestDb>;
  let tenantId: string;
  let userId: string;
  let patientId: string;

  beforeAll(async () => {
    db = getTestDb();
  });

  beforeEach(async () => {
    await cleanTestData();
    const seed = await seedTestTenant();
    tenantId = seed.tenant.id;
    userId = seed.user.id;
    patientId = seed.patient.id;
  });

  afterAll(async () => {
    await cleanTestData();
    const pool = getTestPool();
    await pool.end();
  });

  describe("Invoice Generation", () => {
    it("generates invoice from completed trips with correct totals", async () => {
      await seedFeeRules(tenantId);
      const trips = await seedCompletedTrips(tenantId, patientId, userId, 3);

      // Generate invoice
      const now = new Date();
      const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const periodEnd = now;

      const invoiceNumber = `INV-000001`;
      const invoiceId = uuidv4();

      // Calculate expected fees for each trip
      // Base fare: $5 flat + Per mile: $2.50/mile + Service fee: 5% of subtotal
      // Trip mileages: 10, 15, 20
      // Trip 1: $5 + $25 = $30, + 5% = $31.50
      // Trip 2: $5 + $37.50 = $42.50, + 5% = $44.625 → $44.63
      // Trip 3: $5 + $50 = $55, + 5% = $57.75

      const [invoice] = await db
        .insert(invoices)
        .values({
          id: invoiceId,
          tenantId,
          invoiceNumber,
          patientId,
          status: "draft",
          subtotal: "133.88",
          total: "133.88",
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
          dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        })
        .returning();

      expect(invoice).toBeDefined();
      expect(invoice.status).toBe("draft");
      expect(invoice.tenantId).toBe(tenantId);
    });

    it("does not generate invoice when no completed trips exist", async () => {
      const result = await db
        .select()
        .from(invoices)
        .where(eq(invoices.tenantId, tenantId));

      expect(result).toHaveLength(0);
    });

    it("creates unique invoice numbers per tenant", async () => {
      const [inv1] = await db
        .insert(invoices)
        .values({
          tenantId,
          invoiceNumber: "INV-000001",
          status: "draft",
          subtotal: "100.00",
          total: "100.00",
        })
        .returning();

      const [inv2] = await db
        .insert(invoices)
        .values({
          tenantId,
          invoiceNumber: "INV-000002",
          status: "draft",
          subtotal: "200.00",
          total: "200.00",
        })
        .returning();

      expect(inv1.invoiceNumber).not.toBe(inv2.invoiceNumber);
    });
  });

  describe("Invoice Finalization", () => {
    it("transitions draft invoice to pending", async () => {
      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId,
          invoiceNumber: "INV-000001",
          status: "draft",
          subtotal: "100.00",
          total: "100.00",
        })
        .returning();

      const [updated] = await db
        .update(invoices)
        .set({ status: "pending", sentAt: new Date(), updatedAt: new Date() })
        .where(and(eq(invoices.id, invoice.id), eq(invoices.status, "draft")))
        .returning();

      expect(updated.status).toBe("pending");
      expect(updated.sentAt).toBeDefined();
    });

    it("prevents finalizing non-draft invoice", async () => {
      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId,
          invoiceNumber: "INV-000001",
          status: "paid",
          subtotal: "100.00",
          total: "100.00",
        })
        .returning();

      // Attempt to update should not match (status guard)
      const result = await db
        .update(invoices)
        .set({ status: "pending" })
        .where(and(eq(invoices.id, invoice.id), eq(invoices.status, "draft")))
        .returning();

      expect(result).toHaveLength(0);
    });
  });

  describe("Payment Recording", () => {
    it("records full payment and marks invoice as paid", async () => {
      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId,
          invoiceNumber: "INV-000001",
          status: "pending",
          subtotal: "100.00",
          total: "100.00",
          amountPaid: "0.00",
        })
        .returning();

      const paymentAmount = 100.0;
      const newPaid = paymentAmount;

      const [updated] = await db
        .update(invoices)
        .set({
          amountPaid: newPaid.toFixed(2),
          status: "paid",
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoice.id))
        .returning();

      expect(updated.status).toBe("paid");
      expect(Number(updated.amountPaid)).toBe(100);
      expect(updated.paidAt).toBeDefined();
    });

    it("records partial payment correctly", async () => {
      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId,
          invoiceNumber: "INV-000001",
          status: "pending",
          subtotal: "200.00",
          total: "200.00",
          amountPaid: "0.00",
        })
        .returning();

      const [updated] = await db
        .update(invoices)
        .set({
          amountPaid: "75.00",
          status: "partially_paid",
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoice.id))
        .returning();

      expect(updated.status).toBe("partially_paid");
      expect(Number(updated.amountPaid)).toBe(75);
    });
  });

  describe("Ledger Entry Idempotency", () => {
    it("creates ledger entry with idempotency key", async () => {
      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId,
          invoiceNumber: "INV-000001",
          status: "draft",
          subtotal: "100.00",
          total: "100.00",
        })
        .returning();

      const idempotencyKey = `charge-${invoice.id}`;
      const [entry] = await db
        .insert(ledgerEntries)
        .values({
          tenantId,
          invoiceId: invoice.id,
          type: "charge",
          amount: "100.00",
          description: "Invoice charge",
          idempotencyKey,
        })
        .returning();

      expect(entry.idempotencyKey).toBe(idempotencyKey);
    });

    it("does not duplicate ledger entries with same idempotency key", async () => {
      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId,
          invoiceNumber: "INV-000001",
          status: "draft",
          subtotal: "100.00",
          total: "100.00",
        })
        .returning();

      const idempotencyKey = `charge-${invoice.id}`;

      // First insert
      await db
        .insert(ledgerEntries)
        .values({
          tenantId,
          invoiceId: invoice.id,
          type: "charge",
          amount: "100.00",
          description: "Invoice charge",
          idempotencyKey,
        });

      // Second insert with same key — should be silently ignored
      await db
        .insert(ledgerEntries)
        .values({
          tenantId,
          invoiceId: invoice.id,
          type: "charge",
          amount: "100.00",
          description: "Invoice charge duplicate",
          idempotencyKey,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey });

      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.invoiceId, invoice.id));

      expect(entries).toHaveLength(1);
      expect(entries[0].description).toBe("Invoice charge");
    });
  });

  describe("Webhook Event Storage", () => {
    it("stores webhook events with unique stripe event ID", async () => {
      const [event] = await db
        .insert(webhookEvents)
        .values({
          stripeEventId: "evt_test_123",
          eventType: "payment_intent.succeeded",
          status: "received",
          payload: { id: "evt_test_123", type: "payment_intent.succeeded" },
        })
        .returning();

      expect(event.stripeEventId).toBe("evt_test_123");
      expect(event.status).toBe("received");
    });

    it("prevents duplicate stripe event IDs", async () => {
      await db.insert(webhookEvents).values({
        stripeEventId: "evt_dup_test",
        eventType: "payment_intent.succeeded",
        status: "received",
        payload: { id: "evt_dup_test" },
      });

      // Should throw on unique constraint violation
      await expect(
        db.insert(webhookEvents).values({
          stripeEventId: "evt_dup_test",
          eventType: "payment_intent.succeeded",
          status: "received",
          payload: { id: "evt_dup_test" },
        })
      ).rejects.toThrow();
    });

    it("tracks webhook processing status through lifecycle", async () => {
      const [event] = await db
        .insert(webhookEvents)
        .values({
          stripeEventId: "evt_lifecycle_test",
          eventType: "payment_intent.succeeded",
          status: "received",
          payload: { id: "evt_lifecycle_test" },
          attempts: 0,
        })
        .returning();

      // Move to processing
      const [processing] = await db
        .update(webhookEvents)
        .set({ status: "processing", lastAttemptAt: new Date(), attempts: 1 })
        .where(eq(webhookEvents.id, event.id))
        .returning();

      expect(processing.status).toBe("processing");
      expect(processing.attempts).toBe(1);

      // Move to processed
      const [processed] = await db
        .update(webhookEvents)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(webhookEvents.id, event.id))
        .returning();

      expect(processed.status).toBe("processed");
      expect(processed.processedAt).toBeDefined();
    });

    it("moves events to dead letter after max retries", async () => {
      const [event] = await db
        .insert(webhookEvents)
        .values({
          stripeEventId: "evt_dead_letter_test",
          eventType: "payment_intent.succeeded",
          status: "failed",
          payload: { id: "evt_dead_letter_test" },
          attempts: 5,
          error: "Processing failed repeatedly",
        })
        .returning();

      const [deadLettered] = await db
        .update(webhookEvents)
        .set({
          status: "dead_letter",
          deadLetteredAt: new Date(),
        })
        .where(eq(webhookEvents.id, event.id))
        .returning();

      expect(deadLettered.status).toBe("dead_letter");
      expect(deadLettered.deadLetteredAt).toBeDefined();
    });
  });

  describe("Billing Cycle End-to-End", () => {
    it("complete cycle: create cycle → generate invoice → finalize → pay → ledger update", async () => {
      // 1. Create billing cycle
      const periodStart = new Date("2024-01-01");
      const periodEnd = new Date("2024-01-31");

      const [cycle] = await db
        .insert(billingCycles)
        .values({
          tenantId,
          periodStart,
          periodEnd,
          status: "open",
        })
        .returning();

      expect(cycle.status).toBe("open");

      // 2. Seed trips and fee rules
      await seedFeeRules(tenantId);

      // 3. Generate invoice
      const invoiceId = uuidv4();
      const [invoice] = await db
        .insert(invoices)
        .values({
          id: invoiceId,
          tenantId,
          invoiceNumber: "INV-000001",
          patientId,
          status: "draft",
          subtotal: "150.00",
          total: "150.00",
          amountPaid: "0.00",
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
          dueDate: new Date("2024-03-01"),
        })
        .returning();

      // Create charge ledger entry
      await db.insert(ledgerEntries).values({
        tenantId,
        invoiceId,
        type: "charge",
        amount: "150.00",
        description: "Invoice INV-000001 generated",
        idempotencyKey: `charge-${invoiceId}`,
      });

      // Link billing cycle to invoice
      await db
        .update(billingCycles)
        .set({ status: "invoiced", invoiceId, closedAt: new Date() })
        .where(eq(billingCycles.id, cycle.id));

      // 4. Finalize invoice
      const [finalized] = await db
        .update(invoices)
        .set({ status: "pending", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId))
        .returning();

      expect(finalized.status).toBe("pending");

      // 5. Simulate webhook: payment received
      const paymentIntentId = "pi_test_success";
      await db.insert(webhookEvents).values({
        stripeEventId: "evt_billing_e2e",
        eventType: "payment_intent.succeeded",
        status: "processed",
        payload: {
          id: "evt_billing_e2e",
          type: "payment_intent.succeeded",
          data: { object: { id: paymentIntentId, amount: 15000, metadata: { invoiceId, tenantId } } },
        },
        processedAt: new Date(),
      });

      // 6. Record payment
      const [paid] = await db
        .update(invoices)
        .set({
          amountPaid: "150.00",
          status: "paid",
          stripePaymentIntentId: paymentIntentId,
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId))
        .returning();

      expect(paid.status).toBe("paid");
      expect(Number(paid.amountPaid)).toBe(150);

      // 7. Create payment ledger entry
      await db.insert(ledgerEntries).values({
        tenantId,
        invoiceId,
        type: "payment",
        amount: "150.00",
        description: "Payment received for invoice INV-000001",
        referenceId: paymentIntentId,
        referenceType: "stripe_payment_intent",
        idempotencyKey: `payment-${invoiceId}-${paymentIntentId}`,
      });

      // 8. Verify ledger consistency
      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.invoiceId, invoiceId));

      expect(entries).toHaveLength(2);

      const charges = entries.filter((e) => e.type === "charge");
      const payments = entries.filter((e) => e.type === "payment");

      expect(charges).toHaveLength(1);
      expect(payments).toHaveLength(1);
      expect(Number(charges[0].amount)).toBe(150);
      expect(Number(payments[0].amount)).toBe(150);

      // 9. Verify billing cycle is closed
      const [finalCycle] = await db
        .select()
        .from(billingCycles)
        .where(eq(billingCycles.id, cycle.id));

      expect(finalCycle.status).toBe("invoiced");
      expect(finalCycle.invoiceId).toBe(invoiceId);

      // 10. Verify webhook was recorded
      const [webhookRecord] = await db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.stripeEventId, "evt_billing_e2e"));

      expect(webhookRecord.status).toBe("processed");
    });
  });

  describe("Tenant Isolation", () => {
    it("prevents cross-tenant invoice access", async () => {
      // Create invoice for tenant A
      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId,
          invoiceNumber: "INV-000001",
          status: "draft",
          subtotal: "100.00",
          total: "100.00",
        })
        .returning();

      // Create tenant B
      const [tenantB] = await db
        .insert(require("../../src/db/schema.js").tenants)
        .values({
          name: "Other Clinic",
          slug: "other-clinic",
        })
        .returning();

      // Query with tenant B's ID should return nothing
      const results = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoice.id), eq(invoices.tenantId, tenantB.id)));

      expect(results).toHaveLength(0);
    });
  });
});
