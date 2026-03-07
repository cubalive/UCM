import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { TEAM_ID, APP_DOMAINS, APP_BUNDLES, AASA_URLS, getRedirectBaseUrlForRole, getAASA, type AppKey } from "../config/apps";
import { storage } from "../storage";
import { existsSync } from "fs";
import { resolve } from "path";

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

export async function iconAssetsStatusHandler(_req: AuthRequest, res: Response) {
  const cwd = process.cwd();
  const APPS = ["driver", "clinic", "admin"] as const;
  const ICON_SIZES = ["icon-1024.png", "icon-512.png", "icon-192.png"];
  const SVG_FILES = ["icon.svg", "splash.svg"];

  const appStatus: Record<string, { svgs: boolean; pngs: boolean; capacitorResource: boolean; details: Record<string, boolean> }> = {};

  for (const app of APPS) {
    const details: Record<string, boolean> = {};

    for (const svg of SVG_FILES) {
      details[`svg/${svg}`] = existsSync(resolve(cwd, `client/public/app-icons/${app}/${svg}`));
    }

    for (const png of ICON_SIZES) {
      details[`generated/${png}`] = existsSync(resolve(cwd, `client/public/generated-icons/${app}/${png}`));
    }

    details["generated/splash-2732.png"] = existsSync(resolve(cwd, `client/public/generated-icons/${app}/splash-2732.png`));
    details["capacitor/icon-1024.png"] = existsSync(resolve(cwd, `mobile-${app}/resources/icon-1024.png`));
    details["capacitor/splash/splash-2732.png"] = existsSync(resolve(cwd, `mobile-${app}/resources/splash/splash-2732.png`));

    const svgs = SVG_FILES.every((f) => details[`svg/${f}`]);
    const pngs = ICON_SIZES.every((f) => details[`generated/${f}`]) && details["generated/splash-2732.png"];
    const capacitorResource = details["capacitor/icon-1024.png"] && details["capacitor/splash/splash-2732.png"];

    appStatus[app] = { svgs, pngs, capacitorResource, details };
  }

  const driverIcons = appStatus.driver.svgs && appStatus.driver.pngs;
  const clinicIcons = appStatus.clinic.svgs && appStatus.clinic.pngs;
  const adminIcons = appStatus.admin.svgs && appStatus.admin.pngs;
  const generatedPNGs = APPS.every((a) => appStatus[a].pngs);
  const capacitorResources = APPS.every((a) => appStatus[a].capacitorResource);

  res.json({
    driverIcons,
    clinicIcons,
    adminIcons,
    generatedPNGs,
    capacitorResources,
    apps: appStatus,
  });
}

export async function playstoreReadinessHandler(_req: AuthRequest, res: Response) {
  const cwd = process.cwd();
  const APPS = ["driver", "clinic", "admin"] as const;

  const androidProject = existsSync(resolve(cwd, "android/app/build.gradle"))
    && existsSync(resolve(cwd, "android/app/src/main/AndroidManifest.xml"));

  let targetSdk34 = false;
  try {
    const { readFileSync } = await import("fs");
    const varsContent = readFileSync(resolve(cwd, "android/variables.gradle"), "utf-8");
    const compileSdk = varsContent.match(/compileSdkVersion\s*=\s*(\d+)/);
    const targetSdk = varsContent.match(/targetSdkVersion\s*=\s*(\d+)/);
    targetSdk34 = (compileSdk && parseInt(compileSdk[1]) >= 34) && (targetSdk && parseInt(targetSdk[1]) >= 34) || false;
  } catch {}

  let permissionsValid = false;
  try {
    const { readFileSync } = await import("fs");
    const manifest = readFileSync(resolve(cwd, "android/app/src/main/AndroidManifest.xml"), "utf-8");
    const requiredPerms = ["INTERNET", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "FOREGROUND_SERVICE"];
    permissionsValid = requiredPerms.every((p) => manifest.includes(`android.permission.${p}`));
  } catch {}

  const iconsGenerated = APPS.every((app) =>
    ["icon-1024.png", "icon-512.png", "icon-192.png"].every((f) =>
      existsSync(resolve(cwd, `client/public/generated-icons/${app}/${f}`))
    )
  );

  const screenshotsGenerated = APPS.every((app) =>
    ["01-login.png", "02-map.png", "03-trips.png", "04-patient.png", "05-dashboard.png"].every((f) =>
      existsSync(resolve(cwd, `playstore-assets/screenshots/${app}/${f}`))
    )
  );

  const featureGraphics = APPS.every((app) =>
    existsSync(resolve(cwd, `playstore-assets/${app}/${app}-feature.png`))
  );

  res.json({
    androidProject,
    targetSdk34,
    permissionsValid,
    iconsGenerated,
    screenshotsGenerated,
    featureGraphics,
  });
}
