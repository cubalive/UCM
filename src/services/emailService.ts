import nodemailer from "nodemailer";
import logger from "../lib/logger.js";

let transporter: nodemailer.Transporter | null = null;
let smtpVerified = false;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });

    // Verify SMTP connection on first use (non-blocking)
    if (!smtpVerified) {
      transporter.verify()
        .then(() => {
          smtpVerified = true;
          logger.info("SMTP connection verified successfully");
        })
        .catch((err) => {
          logger.warn("SMTP connection verification failed — emails may not be delivered", { error: err.message });
        });
    }
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
    logger.info("Email skipped (SMTP not configured)", { to: options.to, subject: options.subject });
    return false;
  }

  const mailOptions = {
    from: process.env.FROM_EMAIL || "noreply@ucm.example.com",
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: options.attachments,
  };

  // Single retry for transient connection errors
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const info = await t.sendMail(mailOptions);
      logger.info("Email sent", { to: options.to, subject: options.subject, messageId: info.messageId, attempt });
      return true;
    } catch (err: any) {
      const isTransient = err.code === "ECONNRESET" || err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.responseCode >= 400 && err.responseCode < 500;
      if (attempt === 1 && isTransient) {
        logger.warn("Email send failed (transient), retrying", { to: options.to, error: err.message, code: err.code });
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      logger.error("Failed to send email", {
        to: options.to,
        subject: options.subject,
        error: err.message,
        code: err.code,
        responseCode: err.responseCode,
        attempt,
      });
      return false;
    }
  }
  return false;
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

export async function sendWelcomeEmail(to: string, firstName: string, companyName: string, role: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: `Welcome to UCM - ${companyName}`,
    html: `
      <h2>Welcome to UCM, ${firstName}!</h2>
      <p>Your account has been created for <strong>${companyName}</strong>.</p>
      <p><strong>Role:</strong> ${role}</p>
      <p>Log in to get started with your ${role === "driver" ? "trips" : role === "clinic" ? "patient management" : "dashboard"}.</p>
    `,
    text: `Welcome to UCM, ${firstName}! Your ${role} account for ${companyName} is ready. Log in to get started.`,
  });
}

export async function sendPasswordResetEmail(to: string, firstName: string, resetUrl: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: "Password Reset Request - UCM",
    html: `
      <h2>Password Reset</h2>
      <p>Hi ${firstName},</p>
      <p>A password reset was requested for your UCM account.</p>
      <p><a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
      <p>This link expires in 15 minutes. If you did not request this, you can safely ignore this email.</p>
    `,
    text: `Password reset requested. Visit ${resetUrl} to reset your password. This link expires in 15 minutes.`,
  });
}

export async function sendBillingReminderEmail(to: string, invoiceNumber: string, total: string, dueDate: string, daysUntilDue: number): Promise<boolean> {
  const urgency = daysUntilDue <= 0 ? "OVERDUE" : daysUntilDue <= 3 ? "Due Soon" : "Reminder";
  return sendEmail({
    to,
    subject: `${urgency}: Invoice ${invoiceNumber} - $${total} due ${dueDate}`,
    html: `
      <h2>Invoice ${urgency}</h2>
      <p>Invoice <strong>${invoiceNumber}</strong> for <strong>$${total}</strong> is ${daysUntilDue <= 0 ? "overdue" : `due on ${dueDate}`}.</p>
      ${daysUntilDue <= 0 ? "<p style='color: #dc2626;'><strong>This invoice is past due. Please submit payment immediately.</strong></p>" : ""}
      <p>Please log in to your account to view and pay this invoice.</p>
    `,
    text: `Invoice ${invoiceNumber} for $${total} is ${daysUntilDue <= 0 ? "overdue" : `due on ${dueDate}`}. Please log in to pay.`,
  });
}

export async function sendOperationalAlertEmail(to: string, alertType: string, message: string, details?: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: `UCM Alert: ${alertType}`,
    html: `
      <h2 style="color: #dc2626;">Operational Alert</h2>
      <p><strong>Type:</strong> ${alertType}</p>
      <p>${message}</p>
      ${details ? `<pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 12px;">${details}</pre>` : ""}
      <p>Log in to your admin dashboard to investigate.</p>
    `,
    text: `UCM Alert: ${alertType}. ${message}. ${details || ""}`,
  });
}
