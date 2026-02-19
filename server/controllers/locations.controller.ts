import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import { usStates, usCities } from "@shared/schema";
import { eq, and, ilike, asc } from "drizzle-orm";

export async function getStatesHandler(_req: AuthRequest, res: Response) {
  try {
    const states = await db
      .select()
      .from(usStates)
      .orderBy(asc(usStates.name));
    res.json({ ok: true, items: states });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getCitiesByStateHandler(req: AuthRequest, res: Response) {
  try {
    const stateCode = (req.query.state as string || "").toUpperCase().trim();
    const search = (req.query.search as string || "").trim();

    if (!stateCode) {
      return res.status(400).json({ message: "state query parameter required" });
    }

    let query = db
      .select()
      .from(usCities)
      .where(
        search
          ? and(eq(usCities.stateCode, stateCode), ilike(usCities.city, `%${search}%`))
          : eq(usCities.stateCode, stateCode)
      )
      .orderBy(asc(usCities.city));

    const cities = await query;
    res.json({ ok: true, items: cities });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function resolveCityHandler(req: AuthRequest, res: Response) {
  try {
    const cityId = parseInt(req.query.cityId as string);
    if (isNaN(cityId)) {
      return res.status(400).json({ message: "cityId query parameter required" });
    }

    const [city] = await db
      .select({
        id: usCities.id,
        city: usCities.city,
        stateCode: usCities.stateCode,
        stateName: usStates.name,
        population: usCities.population,
      })
      .from(usCities)
      .innerJoin(usStates, eq(usCities.stateCode, usStates.code))
      .where(eq(usCities.id, cityId));

    if (!city) {
      return res.status(404).json({ message: "City not found" });
    }

    res.json({ ok: true, item: city });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function searchAllCitiesHandler(req: AuthRequest, res: Response) {
  try {
    const search = (req.query.search as string || "").trim();
    if (!search || search.length < 2) {
      return res.status(400).json({ message: "search query must be at least 2 characters" });
    }

    const cities = await db
      .select({
        id: usCities.id,
        city: usCities.city,
        stateCode: usCities.stateCode,
        stateName: usStates.name,
        population: usCities.population,
      })
      .from(usCities)
      .innerJoin(usStates, eq(usCities.stateCode, usStates.code))
      .where(ilike(usCities.city, `%${search}%`))
      .orderBy(asc(usCities.city))
      .limit(50);

    res.json({ ok: true, items: cities });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
