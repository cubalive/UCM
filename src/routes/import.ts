import { Router, Request, Response } from "express";
import multer from "multer";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { importRateLimiter } from "../middleware/rateLimiter.js";
import { previewImport, executeImport, type ImportOptions } from "../services/importService.js";
import { type EntityType, type DedupeStrategy } from "../services/importEngine.js";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, authorize("admin"), tenantIsolation, importRateLimiter);

// 10MB file size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/tab-separated-values",
    ];
    // Also check extension since MIME can be unreliable
    const ext = file.originalname.toLowerCase().split(".").pop();
    if (allowed.includes(file.mimetype) || ["csv", "xlsx", "xls", "tsv", "txt"].includes(ext || "")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and Excel files are supported"));
    }
  },
});

const VALID_ENTITIES: EntityType[] = ["patients", "trips", "drivers"];
const VALID_STRATEGIES: DedupeStrategy[] = ["email", "phone", "name_dob", "external_id", "name_address"];

// POST /api/import/preview - Upload file and get column mapping preview
router.post("/preview", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const entity = req.body.entity as EntityType;
    if (!entity || !VALID_ENTITIES.includes(entity)) {
      return res.status(400).json({ error: `entity must be one of: ${VALID_ENTITIES.join(", ")}` });
    }

    const columnOverrides = req.body.columnOverrides ? JSON.parse(req.body.columnOverrides) : undefined;

    const preview = await previewImport(
      req.file.originalname,
      req.file.buffer,
      entity,
      columnOverrides
    );

    res.json(preview);
  } catch (err: any) {
    logger.error("Import preview failed", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/import/execute - Execute import (or dry-run)
router.post("/execute", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const entity = req.body.entity as EntityType;
    if (!entity || !VALID_ENTITIES.includes(entity)) {
      return res.status(400).json({ error: `entity must be one of: ${VALID_ENTITIES.join(", ")}` });
    }

    const dryRun = req.body.dryRun === "true" || req.body.dryRun === true;
    const skipDuplicates = req.body.skipDuplicates !== "false";

    let dedupeStrategies: DedupeStrategy[] = ["email", "phone"];
    if (req.body.dedupeStrategies) {
      const parsed = JSON.parse(req.body.dedupeStrategies);
      if (Array.isArray(parsed)) {
        dedupeStrategies = parsed.filter((s: string) => VALID_STRATEGIES.includes(s as DedupeStrategy)) as DedupeStrategy[];
      }
    }

    const columnOverrides = req.body.columnOverrides ? JSON.parse(req.body.columnOverrides) : undefined;

    const tenantId = (req as any).tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: "Tenant context required" });
    }

    const options: ImportOptions = {
      tenantId,
      entity,
      dryRun,
      dedupeStrategies,
      columnOverrides,
      skipDuplicates,
      defaultTimezone: req.body.timezone || "America/New_York",
    };

    const result = await executeImport(req.file.originalname, req.file.buffer, options);

    logger.info("Import completed", {
      tenantId,
      entity,
      dryRun,
      totalRows: result.totalRows,
      inserted: result.inserted,
      duplicates: result.duplicates,
      errors: result.errors.length,
    });

    res.json(result);
  } catch (err: any) {
    logger.error("Import execution failed", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/import/template/:entity - Download CSV template
router.get("/template/:entity", (req: Request, res: Response) => {
  const entity = req.params.entity as EntityType;
  if (!VALID_ENTITIES.includes(entity)) {
    return res.status(400).json({ error: `entity must be one of: ${VALID_ENTITIES.join(", ")}` });
  }

  const templates: Record<EntityType, string> = {
    patients: "first_name,last_name,date_of_birth,phone,email,address,insurance_id,notes\nJohn,Doe,1985-03-15,+13055551234,john@example.com,\"123 Main St, Miami, FL\",INS-123456,Wheelchair required",
    trips: "patient_first_name,patient_last_name,pickup_address,dropoff_address,scheduled_date,scheduled_time,vehicle_type,notes\nJohn,Doe,\"123 Main St, Miami, FL\",\"456 Oak Ave, Miami, FL\",2025-03-15,09:00 AM,Sedan,",
    drivers: "first_name,last_name,email,phone,vehicle_type,license_number\nJane,Smith,jane@example.com,+13055559876,Sedan,FL-DL-12345",
  };

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${entity}_import_template.csv`);
  res.send(templates[entity]);
});

export default router;
