import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { companies } from "@shared/schema";
import { eq, or } from "drizzle-orm";

const router = Router();

/**
 * GET /api/branding/resolve?domain=mycompany
 * Resolves a custom domain/subdomain to company branding info.
 * No auth required — this is used before login to show proper branding.
 */
router.get("/api/branding/resolve", async (req: Request, res: Response) => {
  try {
    const domain = (req.query.domain as string || "").trim().toLowerCase();
    if (!domain) {
      return res.status(400).json({ message: "domain parameter required" });
    }

    const [company] = await db.select({
      id: companies.id,
      name: companies.name,
      logoUrl: companies.logoUrl,
      brandColor: companies.brandColor,
      brandTagline: companies.brandTagline,
      customDomain: companies.customDomain,
    })
    .from(companies)
    .where(eq(companies.customDomain, domain))
    .limit(1);

    if (!company) {
      return res.status(404).json({ message: "Company not found for this domain" });
    }

    res.json({
      companyId: company.id,
      name: company.name,
      logoUrl: company.logoUrl ? `/api/companies/${company.id}/logo` : null,
      brandColor: company.brandColor,
      brandTagline: company.brandTagline,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export function registerBrandingRoutes(app: Router) {
  app.use(router);
}

export default router;
