import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const EMAIL_FROM = process.env.EMAIL_FROM || "no-reply@unitedcaremobility.com";
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "United Care Mobility";

export interface SendEmailResult {
  success: boolean;
  error?: string;
  id?: string;
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  if (!resend) {
    console.error("[EMAIL] Resend API key not configured");
    return { success: false, error: "Email service not configured. Set RESEND_API_KEY." };
  }

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { success: false, error: "Invalid recipient email address" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
      to: [to],
      subject,
      html,
    });

    if (error) {
      console.error("[EMAIL] Resend error:", error.message);
      return { success: false, error: error.message };
    }

    console.log(`[EMAIL] Sent to ${to}, id=${data?.id}`);
    return { success: true, id: data?.id };
  } catch (err: any) {
    console.error("[EMAIL] Exception sending email:", err.message);
    return { success: false, error: err.message };
  }
}

export function buildLoginLinkEmail({
  recipientName,
  loginUrl,
  expiresMinutes,
}: {
  recipientName: string;
  loginUrl: string;
  expiresMinutes: number;
}): { subject: string; html: string } {
  return {
    subject: "Your Login Link - United Care Mobility",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h2 style="color: #1a1a2e; margin: 0;">United Care Mobility</h2>
    <p style="color: #666; font-size: 14px;">Medical Transportation Management</p>
  </div>
  <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <p>Hello ${recipientName},</p>
    <p>You have been sent a secure login link. Click the button below to sign in:</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${loginUrl}" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">
        Sign In
      </a>
    </div>
    <p style="font-size: 13px; color: #666;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 13px; color: #1a73e8; word-break: break-all;">${loginUrl}</p>
    <p style="font-size: 13px; color: #999;">This link expires in ${expiresMinutes} minutes and can only be used once.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">
    If you did not request this link, you can safely ignore this email.
  </p>
</body>
</html>`,
  };
}

export function getEmailHealth() {
  return {
    hasResendKey: !!process.env.RESEND_API_KEY,
    from: EMAIL_FROM,
    fromName: EMAIL_FROM_NAME,
    appPublicUrl: process.env.APP_PUBLIC_URL || "(not set)",
  };
}
