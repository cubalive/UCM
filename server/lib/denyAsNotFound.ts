import type { Response } from "express";

export function denyAsNotFound(res: Response, entityName: string = "Resource"): void {
  res.status(404).json({ message: `${entityName} not found` });
}
