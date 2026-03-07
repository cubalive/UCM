import type { Express } from "express";
import type { Request, Response } from "express";
import { authMiddleware, requireRole } from "../auth";
import { getQueueDepths, getQueueDetailsByType, getDlqJobs, retryDlqJob } from "../lib/jobProcessor";
import { getQueueStats } from "../lib/jobQueue";

export function registerQueueRoutes(app: Express): void {
  app.get(
    "/api/admin/queues",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (_req: Request, res: Response) => {
      try {
        const [depths, byType, stats] = await Promise.all([
          getQueueDepths(),
          getQueueDetailsByType(),
          getQueueStats(),
        ]);

        res.json({
          ok: true,
          depths,
          byType,
          stats,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get(
    "/api/admin/queues/dlq",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);
        const dlqJobs = await getDlqJobs(limit);

        res.json({
          ok: true,
          count: dlqJobs.length,
          jobs: dlqJobs,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/admin/queues/dlq/:jobId/retry",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (req: Request, res: Response) => {
      try {
        const { jobId } = req.params;
        const retried = await retryDlqJob(jobId);

        if (!retried) {
          return res.status(404).json({ error: "Job not found or not in failed state" });
        }

        res.json({ ok: true, jobId, status: "requeued" });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );
}
