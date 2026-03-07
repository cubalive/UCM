import { db } from "./db";
import { sql } from "drizzle-orm";

let initialized = false;

async function ensureSequence() {
  if (initialized) return;
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS public_id_seq START WITH 1 INCREMENT BY 1`);

  const result = await db.execute(
    sql`SELECT COALESCE(MAX(global_seq), 0) as max_num FROM (
      SELECT CASE WHEN public_id ~ '^[0-9]{2}UCM[0-9]+$'
        THEN (CAST(SUBSTRING(public_id FROM 1 FOR 2) AS INTEGER) - 1) * 100000000
             + CAST(SUBSTRING(public_id FROM 6) AS BIGINT)
        ELSE 0
      END as global_seq FROM (
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
  const maxPerPrefix = 99999999;
  const prefixNum = Math.floor(val / (maxPerPrefix + 1)) + 1;
  const seqInPrefix = val % (maxPerPrefix + 1);
  const prefix = String(prefixNum).padStart(2, "0");
  const padded = String(seqInPrefix).padStart(8, "0");
  return `${prefix}UCM${padded}`;
}
