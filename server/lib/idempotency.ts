import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { getJson, setJson } from "./redis";

const IDEMPOTENCY_TTL = 86400;

interface IdempotencyRecord {
  statusCode: number;
  body: any;
  createdAt: number;
}

function getIdempotencyRedisKey(companyId: number | null, key: string): string {
  if (companyId) {
    return `idempo:${companyId}:${key}`;
  }
  return `idempo:global:${key}`;
}

export function idempotencyMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const key = req.headers["idempotency-key"] as string;
  if (!key) return next();

  const companyId = req.user?.companyId ?? null;
  const redisKey = getIdempotencyRedisKey(companyId, key);

  getJson<IdempotencyRecord>(redisKey)
    .then((existing) => {
      if (existing) {
        res.status(existing.statusCode).json(existing.body);
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = function (body: any) {
        const statusCode = res.statusCode;
        if (statusCode >= 200 && statusCode < 300) {
          setJson(redisKey, {
            statusCode,
            body,
            createdAt: Date.now(),
          }, IDEMPOTENCY_TTL).catch((err: any) => { if (err) console.error("[CATCH]", err.message || err); });
        }
        return originalJson(body);
      };

      next();
    })
    .catch(() => next());
}

export async function checkIdempotency(
  companyId: number | null,
  key: string
): Promise<IdempotencyRecord | null> {
  const redisKey = getIdempotencyRedisKey(companyId, key);
  return getJson<IdempotencyRecord>(redisKey);
}

export async function storeIdempotency(
  companyId: number | null,
  key: string,
  statusCode: number,
  body: any
): Promise<void> {
  const redisKey = getIdempotencyRedisKey(companyId, key);
  await setJson(redisKey, { statusCode, body, createdAt: Date.now() }, IDEMPOTENCY_TTL);
}
