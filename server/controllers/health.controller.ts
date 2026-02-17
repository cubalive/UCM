import type { Request, Response } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import { sql } from "drizzle-orm";

const APP_VERSION = "2.0.0";

export async function healthz(_req: Request, res: Response) {
  const start = Date.now();
  let dbOk = false;
  let dbLatencyMs = 0;

  try {
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - dbStart;
    dbOk = true;
  } catch {}

  const ok = dbOk;
  res.status(ok ? 200 : 503).json({
    ok,
    version: APP_VERSION,
    uptime: process.uptime(),
    db: {
      status: dbOk ? "connected" : "disconnected",
      latencyMs: dbLatencyMs,
    },
    timestamp: new Date().toISOString(),
  });
}

export async function healthLegacy(_req: Request, res: Response) {
  let dbStatus = "disconnected";

  try {
    const { pool } = await import("../db");
    await pool.query("SELECT 1");
    dbStatus = "connected";
  } catch {}

  let supabaseStatus = "not_configured";
  try {
    const { getSupabaseServer } = await import("../../lib/supabaseClient");
    const sbServer = getSupabaseServer();
    if (sbServer) {
      const { error } = await sbServer.from("cities").select("id").limit(1);
      supabaseStatus = error ? `error: ${error.message}` : "connected";
    }
  } catch (e: any) {
    supabaseStatus = `error: ${e.message}`;
  }

  const ok = dbStatus === "connected";
  res.status(ok ? 200 : 500).json({
    ok,
    db: dbStatus,
    supabase: supabaseStatus,
    version: APP_VERSION,
  });
}

export function pwaHealth(_req: Request, res: Response) {
  res.json({
    ok: true,
    pwa: true,
    serviceWorker: "sw.js",
    manifest: "/manifest.json",
    timestamp: new Date().toISOString(),
  });
}
