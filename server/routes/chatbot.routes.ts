import type { Express } from "express";
import { authMiddleware, type AuthRequest } from "../auth";
import type { Response } from "express";
import {
  processDispatchMessage,
  createChatSession,
  getChatHistory,
  getActiveSession,
} from "../lib/aiDispatchBot";
import { db } from "../db";
import { dispatchChatSessions } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export function registerChatbotRoutes(app: Express) {
  // Send a message to the dispatch chatbot
  app.post("/api/chatbot/message", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { message, sessionId: providedSessionId } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "message is required" });
      }

      // Get or create session
      let sessionId = providedSessionId;
      if (!sessionId) {
        sessionId = await getActiveSession(userId);
      }
      if (!sessionId) {
        const user = await (await import("../storage")).storage.getUser(userId);
        if (!user) return res.status(404).json({ message: "User not found" });
        sessionId = await createChatSession(
          user.companyId || 0,
          userId,
          (user as any).cityId || null,
          "web"
        );
      }

      const user = await (await import("../storage")).storage.getUser(userId);
      const response = await processDispatchMessage(
        sessionId,
        message,
        user?.companyId || 0,
        userId,
        (user as any)?.cityId || null
      );

      res.json({ ok: true, sessionId, ...response });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get chat history for a session
  app.get("/api/chatbot/history/:sessionId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.sessionId as string);
      const limit = parseInt(req.query.limit as string) || 50;
      const messages = await getChatHistory(sessionId, limit);
      res.json(messages.reverse()); // Oldest first
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // List user's chat sessions
  app.get("/api/chatbot/sessions", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const sessions = await db.select().from(dispatchChatSessions)
        .where(eq(dispatchChatSessions.userId, userId))
        .orderBy(desc(dispatchChatSessions.createdAt))
        .limit(20);
      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create new chat session
  app.post("/api/chatbot/sessions", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const user = await (await import("../storage")).storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const sessionId = await createChatSession(
        user.companyId || 0,
        userId,
        (user as any).cityId || null,
        req.body.channel || "web"
      );
      res.status(201).json({ sessionId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Resolve/close a chat session
  app.patch("/api/chatbot/sessions/:id/resolve", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.id as string);
      await db.update(dispatchChatSessions).set({
        status: "resolved",
        resolvedAt: new Date(),
      }).where(eq(dispatchChatSessions.id, sessionId));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
