/**
 * MFA email helper — sends verification codes via Resend.
 */
export async function sendMfaCodeEmail(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const fromEmail = process.env.FROM_EMAIL || "noreply@unitedcaremobility.com";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: "UCM Security Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #10b981;">United Care Mobility</h2>
          <p>Your verification code is:</p>
          <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; text-align: center; margin: 16px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">${code}</span>
          </div>
          <p style="color: #6b7280; font-size: 14px;">This code expires in 10 minutes. Do not share it with anyone.</p>
        </div>
      `,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Resend API error: ${resp.status} ${body}`);
  }
}
