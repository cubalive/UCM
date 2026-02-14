import type { Response } from "express";
import type { AuthRequest } from "../auth";

const LOCKED_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];

export function tripLockedGuard(trip: { status: string }, req: AuthRequest, res: Response): boolean {
  if (!LOCKED_STATUSES.includes(trip.status)) return false;

  const allowOverride = process.env.ALLOW_COMPLETED_EDIT === "true";
  const isSuperAdmin = req.user?.role === "SUPER_ADMIN";
  if (allowOverride && isSuperAdmin) return false;

  res.status(409).json({
    code: "TRIP_LOCKED",
    message: `Trip is ${trip.status.toLowerCase().replace("_", " ")} and cannot be edited.`,
  });
  return true;
}
