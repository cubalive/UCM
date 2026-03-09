import { Response } from "express";

export function success<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}

export function paginated<T>(
  res: Response,
  data: T[],
  pagination: { page: number; limit: number; total: number }
): void {
  res.json({
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.limit),
    },
  });
}

export function error(
  res: Response,
  message: string,
  status = 500,
  extra?: { code?: string; details?: unknown; retryable?: boolean }
): void {
  const body: Record<string, unknown> = { error: message };
  if (extra?.code) body.code = extra.code;
  if (extra?.details) body.details = extra.details;
  if (extra?.retryable !== undefined) body.retryable = extra.retryable;
  res.status(status).json(body);
}

export function errorFromException(res: Response, err: Error, fallbackStatus = 400): void {
  const msg = err.message.toLowerCase();
  let status = fallbackStatus;
  if (msg.includes("not found")) status = 404;
  else if (msg.includes("unauthorized")) status = 401;
  else if (msg.includes("forbidden")) status = 403;
  error(res, err.message, status);
}
