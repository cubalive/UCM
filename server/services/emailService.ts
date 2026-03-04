import { getSupabaseServer } from "../../lib/supabaseClient";
import { sendEmail } from "../lib/email";
import { getRedirectBaseUrlForRole } from "../config/apps";

const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "United Care Mobility";

export function getPortalBaseUrl(role?: string): string {
  return getRedirectBaseUrlForRole(role || "");
}

function buildPortalLoginLink(actionLink: string, portalUrl: string, extraParams?: Record<string, string>, hashedToken?: string): string {
  try {
    let tokenHash: string | null = hashedToken || null;
    let type = "magiclink";

    if (actionLink) {
      const url = new URL(actionLink);
      tokenHash = url.searchParams.get("token") || url.searchParams.get("token_hash") || tokenHash;
      type = url.searchParams.get("type") || type;
    }

    const loginUrl = new URL(`${portalUrl}/login`);
    if (tokenHash) loginUrl.searchParams.set("token", tokenHash);
    loginUrl.searchParams.set("type", type);
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        loginUrl.searchParams.set(k, v);
      }
    }
    return loginUrl.toString();
  } catch {
    if (hashedToken) {
      return `${portalUrl}/login?token=${encodeURIComponent(hashedToken)}&type=magiclink${extraParams ? "&" + new URLSearchParams(extraParams).toString() : ""}`;
    }
    return `${portalUrl}/login`;
  }
}

function brandedHtml(bodyContent: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h2 style="color: #1a1a2e; margin: 0;">United Care Mobility</h2>
    <p style="color: #666; font-size: 14px;">Medical Transportation Management</p>
  </div>
  <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    ${bodyContent}
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">
    If you did not request this, you can safely ignore this email.
  </p>
</body>
</html>`;
}

export async function sendClinicLoginLink(email: string, clinicName?: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return { success: false, error: "Supabase is not configured." };
  }

  const portalUrl = getPortalBaseUrl("CLINIC");

  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: `${portalUrl}/`,
      },
    });

    if (error) {
      console.error("[emailService] Supabase generateLink failed:", error.message);
      return { success: false, error: `Failed to generate magic link: ${error.message}` };
    }

    const magicLink = data?.properties?.action_link;
    const hashedToken = data?.properties?.hashed_token;
    if (!magicLink && !hashedToken) {
      return { success: false, error: "No magic link returned from Supabase" };
    }

    const productionLink = buildPortalLoginLink(magicLink || "", portalUrl, undefined, hashedToken);
    console.log(`[emailService] Clinic magic link generated — role=CLINIC, portalUrl=${portalUrl}, link=${productionLink}`);

    const name = clinicName || "Clinic User";
    const html = brandedHtml(`
    <p>Hello ${name},</p>
    <p>Your administrator has sent you a secure login link for the United Care Mobility system.</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${productionLink}" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">
        Sign In to UCM
      </a>
    </div>
    <p style="font-size: 13px; color: #666;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 13px; color: #1a73e8; word-break: break-all;">${productionLink}</p>
    <p style="font-size: 13px; color: #999;">This link expires in 1 hour and can only be used once.</p>
    `);

    const result = await sendEmail({
      to: email,
      subject: "Your Clinic Login Link - United Care Mobility",
      html,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log(`[emailService] Clinic login link sent to ${email}`);
    return { success: true };
  } catch (err: any) {
    console.error("[emailService] sendClinicLoginLink error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function sendDriverTempPassword(
  email: string,
  tempPassword: string,
  driverName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const portalUrl = getPortalBaseUrl("DRIVER");
    const name = driverName || "Driver";
    const html = brandedHtml(`
    <p>Hello ${name},</p>
    <p>Your driver account has been created in the United Care Mobility system. Use the credentials below to sign in:</p>
    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; margin: 16px 0;">
      <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
      <p style="margin: 4px 0;"><strong>Temporary Password:</strong> <code style="background: #f0f0f0; padding: 2px 8px; border-radius: 3px; font-size: 14px;">${tempPassword}</code></p>
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}/login" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">
        Sign In to UCM
      </a>
    </div>
    <p style="font-size: 13px; color: #e65100; font-weight: 600;">You will be required to change your password on first login.</p>
    <p style="font-size: 13px; color: #999;">Keep your credentials secure and do not share them.</p>
    `);

    const result = await sendEmail({
      to: email,
      subject: "Your Driver Account Credentials - United Care Mobility",
      html,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log(`[emailService] Driver temp password sent to ${email}`);
    return { success: true };
  } catch (err: any) {
    console.error("[emailService] sendDriverTempPassword error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function sendDispatchLoginLink(email: string, userName?: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return { success: false, error: "Supabase is not configured." };
  }

  const portalUrl = getPortalBaseUrl("DISPATCH");

  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: `${portalUrl}/`,
      },
    });

    if (error) {
      console.error("[emailService] Supabase generateLink failed for dispatch:", error.message);
      return { success: false, error: `Failed to generate magic link: ${error.message}` };
    }

    const magicLink = data?.properties?.action_link;
    const hashedTokenD = data?.properties?.hashed_token;
    if (!magicLink && !hashedTokenD) {
      return { success: false, error: "No magic link returned from Supabase" };
    }

    const productionLink = buildPortalLoginLink(magicLink || "", portalUrl, undefined, hashedTokenD);
    console.log(`[emailService] Dispatch magic link generated — role=DISPATCH, portalUrl=${portalUrl}, link=${productionLink}`);

    const name = userName || "Team Member";
    const html = brandedHtml(`
    <p>Hello ${name},</p>
    <p>Your administrator has sent you a secure login link for the United Care Mobility dispatch system.</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${productionLink}" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">
        Sign In to UCM
      </a>
    </div>
    <p style="font-size: 13px; color: #666;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 13px; color: #1a73e8; word-break: break-all;">${productionLink}</p>
    <p style="font-size: 13px; color: #999;">This link expires in 1 hour and can only be used once.</p>
    `);

    const result = await sendEmail({
      to: email,
      subject: "Your Login Link - United Care Mobility",
      html,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log(`[emailService] Dispatch login link sent to ${email}`);
    return { success: true };
  } catch (err: any) {
    console.error("[emailService] sendDispatchLoginLink error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function sendResetPasswordEmail(
  email: string,
  tempPassword: string,
  userName?: string,
  role?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const portalUrl = getPortalBaseUrl(role);
    const name = userName || "User";
    const html = brandedHtml(`
    <p>Hello ${name},</p>
    <p>Your password has been reset by an administrator. Use the new temporary password below to sign in:</p>
    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; margin: 16px 0;">
      <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
      <p style="margin: 4px 0;"><strong>New Temporary Password:</strong> <code style="background: #f0f0f0; padding: 2px 8px; border-radius: 3px; font-size: 14px;">${tempPassword}</code></p>
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}/login" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">
        Sign In to UCM
      </a>
    </div>
    <p style="font-size: 13px; color: #e65100; font-weight: 600;">You will be required to change your password on first login.</p>
    <p style="font-size: 13px; color: #999;">If you did not request a password reset, please contact your administrator immediately.</p>
    `);

    const result = await sendEmail({
      to: email,
      subject: "Password Reset - United Care Mobility",
      html,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log(`[emailService] Password reset email sent to ${email}`);
    return { success: true };
  } catch (err: any) {
    console.error("[emailService] sendResetPasswordEmail error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function sendForgotPasswordLink(email: string, role?: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return { success: false, error: "Supabase is not configured." };
  }

  const portalUrl = getPortalBaseUrl(role);

  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: `${portalUrl}/login?reset=true`,
      },
    });

    console.log(`[emailService] Recovery link generated — role=${role || "unknown"}, portalUrl=${portalUrl}, redirectTo=${portalUrl}/login?reset=true`);

    if (error) {
      console.error("[emailService] Supabase recovery link failed:", error.message);
      return { success: false, error: `Failed to generate recovery link: ${error.message}` };
    }

    const recoveryLink = data?.properties?.action_link;
    const recoveryHashedToken = data?.properties?.hashed_token;
    if (!recoveryLink && !recoveryHashedToken) {
      return { success: false, error: "No recovery link returned from Supabase" };
    }

    const productionLink = buildPortalLoginLink(recoveryLink || "", portalUrl, { reset: "true" }, recoveryHashedToken);

    const html = brandedHtml(`
    <p>Hello,</p>
    <p>We received a request to reset your password for your United Care Mobility account.</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${productionLink}" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">
        Reset Password
      </a>
    </div>
    <p style="font-size: 13px; color: #666;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 13px; color: #1a73e8; word-break: break-all;">${productionLink}</p>
    <p style="font-size: 13px; color: #999;">This link expires in 1 hour. If you did not request this reset, you can safely ignore this email.</p>
    `);

    const result = await sendEmail({
      to: email,
      subject: "Reset Your Password - United Care Mobility",
      html,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log(`[emailService] Forgot password link sent to ${email}`);
    return { success: true };
  } catch (err: any) {
    console.error("[emailService] sendForgotPasswordLink error:", err.message);
    return { success: false, error: err.message };
  }
}
