import { sendEmail } from "../lib/email";
import { db } from "../db";
import { invoices } from "@shared/schema";
import { eq } from "drizzle-orm";

const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || "https://app.unitedcaremobility.com";

function brandedInvoiceHtml(bodyContent: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h2 style="color: #1a1a2e; margin: 0;">United Care Mobility</h2>
    <p style="color: #666; font-size: 14px;">Medical Transportation Services</p>
  </div>
  <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    ${bodyContent}
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">
    This is an automated invoice from United Care Mobility. If you have questions, please contact us.
  </p>
</body>
</html>`;
}

export async function createStripeCheckoutSession(invoice: {
  id: number;
  amount: string;
  patientName: string;
  serviceDate: string;
  notes?: string | null;
}): Promise<{ url: string; sessionId: string } | null> {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("[InvoiceEmail] STRIPE_SECRET_KEY not configured");
    return null;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const amountCents = Math.round(parseFloat(invoice.amount) * 100);

    if (amountCents <= 0) {
      console.error("[InvoiceEmail] Invalid amount for Stripe session:", invoice.amount);
      return null;
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Medical Transport - Invoice #${invoice.id}`,
              description: `Service for ${invoice.patientName} on ${invoice.serviceDate}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${APP_PUBLIC_URL}/payment-success?invoice=${invoice.id}`,
      cancel_url: `${APP_PUBLIC_URL}/payment-cancelled?invoice=${invoice.id}`,
      metadata: {
        invoice_id: String(invoice.id),
        patient_name: invoice.patientName,
        service_date: invoice.serviceDate,
      },
    });

    return { url: session.url!, sessionId: session.id };
  } catch (err: any) {
    console.error("[InvoiceEmail] Stripe checkout session error:", err.message);
    return null;
  }
}

export async function sendInvoicePaymentEmail(invoiceId: number): Promise<{
  success: boolean;
  error?: string;
  paymentLink?: string;
}> {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    const emailTo = invoice.emailTo;
    if (!emailTo) {
      return { success: false, error: "No email address on invoice" };
    }

    let paymentLink = invoice.stripePaymentLink;
    let sessionId = invoice.stripeCheckoutSessionId;

    if (!paymentLink) {
      const stripeResult = await createStripeCheckoutSession({
        id: invoice.id,
        amount: invoice.amount,
        patientName: invoice.patientName,
        serviceDate: invoice.serviceDate,
        notes: invoice.notes,
      });

      if (!stripeResult) {
        await db.update(invoices).set({
          emailStatus: "failed",
          emailError: "Failed to create Stripe payment session",
        }).where(eq(invoices.id, invoiceId));
        return { success: false, error: "Failed to create Stripe payment session" };
      }

      paymentLink = stripeResult.url;
      sessionId = stripeResult.sessionId;

      await db.update(invoices).set({
        stripePaymentLink: paymentLink,
        stripeCheckoutSessionId: sessionId,
      }).where(eq(invoices.id, invoiceId));
    }

    const amountFormatted = parseFloat(invoice.amount).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });

    const html = brandedInvoiceHtml(`
    <p>Hello ${invoice.patientName},</p>
    <p>You have a new invoice for medical transportation services provided by United Care Mobility.</p>
    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; margin: 16px 0;">
      <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
        <tr><td style="padding: 6px 0; color: #666;">Invoice #</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${invoice.id}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Service Date</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${invoice.serviceDate}</td></tr>
        <tr style="border-top: 1px solid #eee;"><td style="padding: 10px 0; font-weight: 600; font-size: 16px;">Amount Due</td><td style="padding: 10px 0; font-weight: 700; font-size: 18px; text-align: right; color: #1a1a2e;">${amountFormatted}</td></tr>
      </table>
    </div>
    ${invoice.notes ? `<p style="font-size: 13px; color: #666;">Note: ${invoice.notes}</p>` : ""}
    <div style="text-align: center; margin: 24px 0;">
      <a href="${paymentLink}" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Pay ${amountFormatted}
      </a>
    </div>
    <p style="font-size: 13px; color: #666;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 13px; color: #1a73e8; word-break: break-all;">${paymentLink}</p>
    `);

    const emailResult = await sendEmail({
      to: emailTo,
      subject: `Invoice #${invoice.id} - ${amountFormatted} - United Care Mobility`,
      html,
    });

    if (!emailResult.success) {
      await db.update(invoices).set({
        emailStatus: "failed",
        emailError: emailResult.error || "Email send failed",
      }).where(eq(invoices.id, invoiceId));
      return { success: false, error: emailResult.error };
    }

    await db.update(invoices).set({
      emailStatus: "sent",
      emailSentAt: new Date(),
      emailError: null,
    }).where(eq(invoices.id, invoiceId));

    console.log(`[InvoiceEmail] Payment email sent for invoice #${invoice.id} to ${emailTo}`);
    return { success: true, paymentLink };
  } catch (err: any) {
    console.error("[InvoiceEmail] Error:", err.message);
    try {
      await db.update(invoices).set({
        emailStatus: "failed",
        emailError: err.message,
      }).where(eq(invoices.id, invoiceId));
    } catch {}
    return { success: false, error: err.message };
  }
}
