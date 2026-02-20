import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const NO_STORE = "no-store, no-cache, must-revalidate, proxy-revalidate";
  const LONG_CACHE = "public, max-age=31536000, immutable";

  app.get("/sw.js", (_req: Request, res: Response) => {
    res.set({
      "Content-Type": "application/javascript",
      "Cache-Control": NO_STORE,
      "Service-Worker-Allowed": "/",
    });
    res.sendFile(path.resolve(distPath, "sw.js"));
  });

  app.get("/manifest.webmanifest", (_req: Request, res: Response) => {
    res.set({
      "Content-Type": "application/manifest+json",
      "Cache-Control": NO_STORE,
    });
    res.sendFile(path.resolve(distPath, "manifest.webmanifest"));
  });

  app.get("/manifest-driver.webmanifest", (_req: Request, res: Response) => {
    res.set({
      "Content-Type": "application/manifest+json",
      "Cache-Control": NO_STORE,
    });
    res.sendFile(path.resolve(distPath, "manifest-driver.webmanifest"));
  });

  app.get("/manifest.json", (_req: Request, res: Response) => {
    res.set({
      "Content-Type": "application/manifest+json",
      "Cache-Control": NO_STORE,
    });
    res.sendFile(path.resolve(distPath, "manifest.json"));
  });

  app.get("/version.json", (_req: Request, res: Response) => {
    res.set({
      "Content-Type": "application/json",
      "Cache-Control": NO_STORE,
    });
    res.sendFile(path.resolve(distPath, "version.json"));
  });

  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      maxAge: "1y",
      immutable: true,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", LONG_CACHE);
      },
    }),
  );

  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", NO_STORE);
        }
      },
    }),
  );

  app.use("/{*path}", (_req: Request, res: Response) => {
    res.set({ "Cache-Control": NO_STORE });
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
