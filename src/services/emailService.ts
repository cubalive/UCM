import nodemailer from "nodemailer";
import logger from "../lib/logger.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST) {
    logger.warn("SMTP not configured — email sending disabled");
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    logger.info("Email would be sent (SMTP not configured)", { to: options.to, subject: options.subject });
    return false;
  }

  try {
    await t.sendMail({
      from: process.env.FROM_EMAIL || "noreply@ucm.example.com",
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
    });
    logger.info("Email sent", { to: options.to, subject: options.subject });
    return true;
  } catch (err: any) {
    logger.error("Failed to send email", { to: options.to, error: err.message });
    return false;
  }
}

export async function sendInvoiceGeneratedEmail(to: string, invoiceNumber: string, total: string, dueDate: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: `Invoice ${invoiceNumber} Generated`,
    html: `
      <h2>Invoice ${invoiceNumber}</h2>
      <p>A new invoice has been generated for your account.</p>
      <p><strong>Total:</strong> $${total}</p>
      <p><strong>Due Date:</strong> ${dueDate}</p>
      <p>Please log in to your account to view and pay this invoice.</p>
    `,
    text: `Invoice ${invoiceNumber} generated. Total: $${total}. Due: ${dueDate}. Log in to view and pay.`,
  });
}

export async function sendPaymentConfirmedEmail(to: string, invoiceNumber: string, amount: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: `Payment Confirmed - Invoice ${invoiceNumber}`,
    html: `
      <h2>Payment Confirmed</h2>
      <p>We've received your payment of <strong>$${amount}</strong> for invoice ${invoiceNumber}.</p>
      <p>Thank you for your prompt payment.</p>
    `,
    text: `Payment of $${amount} confirmed for invoice ${invoiceNumber}. Thank you.`,
  });
}

export async function sendPaymentFailedEmail(to: string, invoiceNumber: string, errorMessage?: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: `Payment Failed - Invoice ${invoiceNumber}`,
    html: `
      <h2>Payment Failed</h2>
      <p>Your payment for invoice ${invoiceNumber} could not be processed.</p>
      ${errorMessage ? `<p><strong>Reason:</strong> ${errorMessage}</p>` : ""}
      <p>Please log in to your account to retry the payment or update your payment method.</p>
    `,
    text: `Payment failed for invoice ${invoiceNumber}. ${errorMessage || ""}. Please log in to retry.`,
  });
}
