import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { TEAM_ID, APP_DOMAINS, APP_BUNDLES, AASA_URLS, getRedirectBaseUrlForRole, getAASA, type AppKey } from "../config/apps";
import { storage } from "../storage";

export async function authRedirectDebugHandler(req: AuthRequest, res: Response) {
  const email = (req.query.email as string || "").trim().toLowerCase();
  let role = (req.query.role as string || "").toUpperCase();

  if (!role && !email) {
    return res.status(400).json({ error: "role or email query parameter required" });
  }

  let inferredFromEmail = false;
  if (email && !role) {
    try {
      const user = await storage.getUserByEmail(email);
      if (user) {
        role = (user.role || "").toUpperCase();
        inferredFromEmail = true;
      } else {
        return res.status(404).json({ error: `No user found for email: ${email}` });
      }
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to lookup user: ${err.message}` });
    }
  }

  const portalUrl = getRedirectBaseUrlForRole(role);

  const sampleLinks = {
    magicLink: `${portalUrl}/login?token=REDACTED&type=magiclink`,
    recovery: `${portalUrl}/login?token=REDACTED&type=recovery&reset=true`,
    invite: `${portalUrl}/login?token=REDACTED&type=invite`,
  };

  res.json({
    email: email || undefined,
    role,
    inferredFromEmail,
    redirectBaseUrl: portalUrl,
    sampleLinks,
    domainMapping: APP_DOMAINS,
  });
}

export async function aasaStatusHandler(_req: AuthRequest, res: Response) {
  const checks: Record<string, {
    url: string;
    statusCode: number | null;
    contentType: string | null;
    containsExpectedAppId: boolean | null;
    expectedAppId: string;
    actualAppId: string | null;
  }> = {};

  for (const [key, url] of Object.entries(AASA_URLS)) {
    const expectedAASA = getAASA(key as AppKey);
    const expectedAppID = expectedAASA.applinks.details[0].appID;

    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "UCM-AASACheck/1.0" },
        signal: AbortSignal.timeout(10000),
      });

      const ct = resp.headers.get("content-type") || null;

      if (!resp.ok) {
        checks[key] = {
          url,
          statusCode: resp.status,
          contentType: ct,
          containsExpectedAppId: null,
          expectedAppId: expectedAppID,
          actualAppId: null,
        };
        continue;
      }

      const body = await resp.json();
      const actualAppID = body?.applinks?.details?.[0]?.appID || null;

      checks[key] = {
        url,
        statusCode: resp.status,
        contentType: ct,
        containsExpectedAppId: actualAppID === expectedAppID,
        expectedAppId: expectedAppID,
        actualAppId: actualAppID,
      };
    } catch (err: any) {
      checks[key] = {
        url,
        statusCode: null,
        contentType: null,
        containsExpectedAppId: null,
        expectedAppId: expectedAppID,
        actualAppId: null,
      };
    }
  }

  const allPass = Object.values(checks).every((c) => c.containsExpectedAppId === true);

  res.json({
    teamId: TEAM_ID,
    overall: allPass ? "PASS" : "FAIL",
    checks,
  });
}
