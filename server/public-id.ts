import { db } from "./db";
import { sql } from "drizzle-orm";

let initialized = false;

async function ensureSequence() {
  if (initialized) return;
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS public_id_seq START WITH 1 INCREMENT BY 1`);

  const result = await db.execute(
    sql`SELECT COALESCE(MAX(num), 0) as max_num FROM (
      SELECT CASE WHEN public_id ~ '^01UCM[0-9]+$'
        THEN CAST(SUBSTRING(public_id FROM 6) AS INTEGER)
        ELSE 0
      END as num FROM (
        SELECT public_id FROM users
        UNION ALL SELECT public_id FROM vehicles
        UNION ALL SELECT public_id FROM drivers
        UNION ALL SELECT public_id FROM clinics
        UNION ALL SELECT public_id FROM patients
        UNION ALL SELECT public_id FROM trips
      ) all_ids
    ) nums`
  );

  const maxNum = parseInt((result as any).rows?.[0]?.max_num || "0");
  if (maxNum > 0) {
    await db.execute(sql`SELECT setval('public_id_seq', ${maxNum})`);
  }
  initialized = true;
}

export async function generatePublicId(): Promise<string> {
  await ensureSequence();
  const result = await db.execute(sql`SELECT nextval('public_id_seq') as val`);
  const val = parseInt((result as any).rows[0].val);
  const padded = String(val).padStart(6, "0");
  return `01UCM${padded}`;
}
