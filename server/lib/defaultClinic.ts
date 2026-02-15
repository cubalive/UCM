import { db } from "../db";
import { clinics } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generatePublicId } from "../public-id";

const DEFAULT_CLINIC_NAME = "UCM Direct / Private Pay";

const cachedIds = new Map<number, number>();

export async function getDefaultPrivateClinicId(cityId: number): Promise<number> {
  const cached = cachedIds.get(cityId);
  if (cached) {
    const [exists] = await db.select({ id: clinics.id }).from(clinics).where(eq(clinics.id, cached));
    if (exists) return cached;
    cachedIds.delete(cityId);
  }

  const [existing] = await db.select({ id: clinics.id })
    .from(clinics)
    .where(and(eq(clinics.name, DEFAULT_CLINIC_NAME), eq(clinics.cityId, cityId)));

  if (existing) {
    cachedIds.set(cityId, existing.id);
    return existing.id;
  }

  const publicId = await generatePublicId();
  const [created] = await db.insert(clinics).values({
    publicId,
    name: DEFAULT_CLINIC_NAME,
    cityId,
    address: "Internal - No Physical Address",
    facilityType: "clinic",
    active: true,
  }).returning({ id: clinics.id });

  cachedIds.set(cityId, created.id);
  return created.id;
}
