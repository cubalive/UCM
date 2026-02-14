import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { checkRateLimit } from "./rateLimiter";
import { calculatePrivateQuote } from "./privatePricing";
import { getSupabaseServer } from "../../lib/supabaseClient";
import { sendEmail } from "./email";

const router = Router();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN_1 || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function corsMiddleware(req: Request, res: Response, next: () => void) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
}

router.use(corsMiddleware);

function rateLimitMiddleware(limit: number, windowSec: number) {
  return (req: Request, res: Response, next: () => void) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const rl = checkRateLimit(`public:${ip}`, limit, windowSec);
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    if (!rl.allowed) {
      return res.status(429).json({
        error: "Too many requests",
        retryAfterMs: rl.retryAfterMs,
      });
    }
    next();
  };
}

const DISPATCH_EMAIL = process.env.ADMIN_EMAIL || "";

const quoteSchema = z.object({
  pickupAddress: z.string().min(5, "Pickup address is required"),
  dropoffAddress: z.string().min(5, "Dropoff address is required"),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  isWheelchair: z.boolean().default(false),
  roundTrip: z.boolean().default(false),
  passengers: z.number().int().min(1).max(10).default(1),
});

const requestSchema = quoteSchema.extend({
  passengerName: z.string().min(2, "Passenger name is required"),
  passengerPhone: z.string().min(7, "Phone number is required"),
  passengerEmail: z.string().email("Valid email is required"),
  notes: z.string().max(500).optional(),
  stripePaymentIntentId: z.string().optional(),
});

const statusSchema = z.object({
  requestId: z.string().uuid("Invalid request ID"),
});

async function ensurePrivateRequestsTable(): Promise<boolean> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    console.error("[PublicAPI] Supabase not configured");
    return false;
  }
  try {
    const { error } = await supabase.from("private_requests").select("id").limit(1);
    if (error && error.code === "42P01") {
      const { error: createError } = await supabase.rpc("exec_sql", {
        sql_text: `
          CREATE TABLE IF NOT EXISTS private_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            status TEXT NOT NULL DEFAULT 'quote',
            passenger_name TEXT,
            passenger_phone TEXT,
            passenger_email TEXT,
            pickup_address TEXT NOT NULL,
            dropoff_address TEXT NOT NULL,
            scheduled_date TEXT NOT NULL,
            scheduled_time TEXT NOT NULL,
            is_wheelchair BOOLEAN DEFAULT FALSE,
            round_trip BOOLEAN DEFAULT FALSE,
            passengers INTEGER DEFAULT 1,
            notes TEXT,
            quote_cents INTEGER,
            distance_miles NUMERIC(6,1),
            duration_minutes INTEGER,
            breakdown JSONB,
            stripe_payment_intent_id TEXT,
            payment_verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_private_requests_status ON private_requests(status);
          CREATE INDEX IF NOT EXISTS idx_private_requests_email ON private_requests(passenger_email);
        `,
      });
      if (createError) {
        console.error("[PublicAPI] Could not create private_requests table via RPC:", createError.message);
        return false;
      }
      console.log("[PublicAPI] private_requests table created successfully");
    } else if (error) {
      console.error("[PublicAPI] Supabase query error:", error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[PublicAPI] ensurePrivateRequestsTable error:", err.message);
    return false;
  }
}

let tableChecked = false;

router.get("/health", (_req: Request, res: Response) => {
  const supabase = getSupabaseServer();
  let stripeConfigured = false;
  try {
    stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
  } catch {}

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      supabase: !!supabase,
      stripe: stripeConfigured,
      email: !!process.env.RESEND_API_KEY,
      maps: !!process.env.GOOGLE_MAPS_SERVER_KEY,
    },
  });
});

router.post(
  "/quote",
  rateLimitMiddleware(20, 60),
  async (req: Request, res: Response) => {
    try {
      const parsed = quoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const quote = await calculatePrivateQuote(parsed.data);

      return res.json({
        quoteId: crypto.randomUUID(),
        totalCents: quote.totalCents,
        totalFormatted: `$${(quote.totalCents / 100).toFixed(2)}`,
        distanceMiles: quote.baseMiles,
        durationMinutes: quote.baseMinutes,
        breakdown: quote.breakdown,
        isWheelchair: parsed.data.isWheelchair,
        roundTrip: parsed.data.roundTrip,
        validForMinutes: 30,
      });
    } catch (err: any) {
      console.error("[PublicAPI] /quote error:", err.message);
      return res.status(500).json({ error: "Could not calculate quote. Please check addresses." });
    }
  }
);

router.post(
  "/request",
  rateLimitMiddleware(5, 60),
  async (req: Request, res: Response) => {
    try {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const data = parsed.data;

      if (data.stripePaymentIntentId && !process.env.STRIPE_SECRET_KEY) {
        return res.status(503).json({ error: "Payment verification is not configured" });
      }

      if (data.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
        try {
          const Stripe = (await import("stripe")).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          const pi = await stripe.paymentIntents.retrieve(data.stripePaymentIntentId);
          if (pi.status !== "succeeded") {
            return res.status(402).json({ error: "Payment not completed", paymentStatus: pi.status });
          }
        } catch (stripeErr: any) {
          console.error("[PublicAPI] Stripe verification error:", stripeErr.message);
          return res.status(402).json({ error: "Could not verify payment" });
        }
      }

      const quote = await calculatePrivateQuote(data);

      if (!tableChecked) {
        tableChecked = await ensurePrivateRequestsTable();
      }

      const supabase = getSupabaseServer();
      let requestId = crypto.randomUUID();
      let savedToDb = false;

      if (supabase) {
        const insertData = {
          id: requestId,
          status: "pending",
          passenger_name: data.passengerName,
          passenger_phone: data.passengerPhone,
          passenger_email: data.passengerEmail,
          pickup_address: data.pickupAddress,
          dropoff_address: data.dropoffAddress,
          scheduled_date: data.scheduledDate,
          scheduled_time: data.scheduledTime,
          is_wheelchair: data.isWheelchair,
          round_trip: data.roundTrip,
          passengers: data.passengers,
          notes: data.notes || null,
          quote_cents: quote.totalCents,
          distance_miles: quote.baseMiles,
          duration_minutes: quote.baseMinutes,
          breakdown: quote.breakdown,
          stripe_payment_intent_id: data.stripePaymentIntentId || null,
          payment_verified: !!data.stripePaymentIntentId,
        };

        const { error: insertError } = await supabase
          .from("private_requests")
          .insert(insertData);

        if (insertError) {
          console.error("[PublicAPI] Supabase insert error:", insertError.message);
        } else {
          savedToDb = true;
        }
      }

      if (DISPATCH_EMAIL) {
        const emailHtml = buildDispatchNotificationEmail({
          requestId,
          passengerName: data.passengerName,
          passengerPhone: data.passengerPhone,
          passengerEmail: data.passengerEmail,
          pickupAddress: data.pickupAddress,
          dropoffAddress: data.dropoffAddress,
          scheduledDate: data.scheduledDate,
          scheduledTime: data.scheduledTime,
          isWheelchair: data.isWheelchair,
          roundTrip: data.roundTrip,
          passengers: data.passengers || 1,
          totalCents: quote.totalCents,
          distanceMiles: quote.baseMiles,
          notes: data.notes,
        });

        sendEmail({
          to: DISPATCH_EMAIL,
          subject: `New Private Booking Request – ${data.passengerName}`,
          html: emailHtml,
        }).catch((err) =>
          console.error("[PublicAPI] Dispatch email error:", err)
        );
      }

      return res.status(201).json({
        requestId,
        status: "pending",
        totalCents: quote.totalCents,
        totalFormatted: `$${(quote.totalCents / 100).toFixed(2)}`,
        distanceMiles: quote.baseMiles,
        durationMinutes: quote.baseMinutes,
        savedToDb,
        message: "Your booking request has been submitted. Our dispatch team will confirm shortly.",
      });
    } catch (err: any) {
      console.error("[PublicAPI] /request error:", err.message);
      return res.status(500).json({ error: "Could not process booking request" });
    }
  }
);

router.post(
  "/status",
  rateLimitMiddleware(30, 60),
  async (req: Request, res: Response) => {
    try {
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const supabase = getSupabaseServer();
      if (!supabase) {
        return res.status(503).json({ error: "Database not available" });
      }

      const { data, error } = await supabase
        .from("private_requests")
        .select("id, status, quote_cents, distance_miles, duration_minutes, scheduled_date, scheduled_time, is_wheelchair, round_trip, created_at")
        .eq("id", parsed.data.requestId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Request not found" });
      }

      return res.json({
        requestId: data.id,
        status: data.status,
        totalCents: data.quote_cents,
        totalFormatted: data.quote_cents ? `$${(data.quote_cents / 100).toFixed(2)}` : null,
        distanceMiles: data.distance_miles,
        durationMinutes: data.duration_minutes,
        scheduledDate: data.scheduled_date,
        scheduledTime: data.scheduled_time,
        isWheelchair: data.is_wheelchair,
        roundTrip: data.round_trip,
        createdAt: data.created_at,
      });
    } catch (err: any) {
      console.error("[PublicAPI] /status error:", err.message);
      return res.status(500).json({ error: "Could not retrieve status" });
    }
  }
);

function buildDispatchNotificationEmail(details: {
  requestId: string;
  passengerName: string;
  passengerPhone: string;
  passengerEmail: string;
  pickupAddress: string;
  dropoffAddress: string;
  scheduledDate: string;
  scheduledTime: string;
  isWheelchair: boolean;
  roundTrip: boolean;
  passengers: number;
  totalCents: number;
  distanceMiles: number;
  notes?: string;
}): string {
  const d = details;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h2 style="color: #1a1a2e; margin: 0;">United Care Mobility</h2>
    <p style="color: #666; font-size: 14px;">New Private Booking Request</p>
  </div>
  <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 16px;">
    <h3 style="margin-top: 0; color: #1a1a2e;">Booking #${d.requestId.slice(0, 8).toUpperCase()}</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="padding: 6px 0; font-weight: 600;">Passenger:</td><td>${d.passengerName}</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Phone:</td><td>${d.passengerPhone}</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Email:</td><td>${d.passengerEmail}</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Date:</td><td>${d.scheduledDate} at ${d.scheduledTime}</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Pickup:</td><td>${d.pickupAddress}</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Dropoff:</td><td>${d.dropoffAddress}</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Distance:</td><td>${d.distanceMiles} miles</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Wheelchair:</td><td>${d.isWheelchair ? "Yes" : "No"}</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Round Trip:</td><td>${d.roundTrip ? "Yes" : "No"}</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Passengers:</td><td>${d.passengers}</td></tr>
      <tr><td style="padding: 6px 0; font-weight: 600;">Quoted Price:</td><td style="font-weight: 700; color: #16a34a;">$${(d.totalCents / 100).toFixed(2)}</td></tr>
      ${d.notes ? `<tr><td style="padding: 6px 0; font-weight: 600;">Notes:</td><td>${d.notes}</td></tr>` : ""}
    </table>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">
    This is an automated notification from the UCM Public Booking API.
  </p>
</body>
</html>`;
}

export function registerPublicApiRoutes(app: import("express").Express) {
  app.use("/api/public", router);
  console.log("[PublicAPI] Public booking API registered at /api/public");
}
