/**
 * F1/F6 FIX: File upload validation middleware.
 * Uses magic byte detection (not just extension/MIME header) to prevent
 * malicious file uploads disguised as legitimate file types.
 */
import type { Request, Response, NextFunction } from "express";

// Magic byte signatures for allowed file types
const MAGIC_BYTES: Record<string, { bytes: number[]; offset?: number }[]> = {
  // Documents
  pdf: [{ bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  // Images
  jpg: [{ bytes: [0xff, 0xd8, 0xff] }],
  jpeg: [{ bytes: [0xff, 0xd8, 0xff] }],
  png: [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  webp: [{ bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }],
  // Spreadsheets
  xlsx: [{ bytes: [0x50, 0x4b, 0x03, 0x04] }], // ZIP-based (also .docx, .pptx)
  xls: [{ bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }], // OLE2
};

// Dangerous file types to always reject (even if renamed)
const DANGEROUS_MAGIC_BYTES = [
  { name: "exe", bytes: [0x4d, 0x5a] }, // Windows PE executable (MZ header)
  { name: "elf", bytes: [0x7f, 0x45, 0x4c, 0x46] }, // Linux ELF binary
  { name: "script", bytes: [0x23, 0x21] }, // Shebang (#!)
];

export type AllowedCategory = "documents" | "images" | "timecards" | "photos";

const CATEGORY_EXTENSIONS: Record<AllowedCategory, string[]> = {
  documents: ["pdf", "jpg", "jpeg", "png", "webp"],
  images: ["jpg", "jpeg", "png", "webp"],
  timecards: ["csv", "xls", "xlsx"],
  photos: ["jpg", "jpeg", "png", "webp"],
};

function matchesMagicBytes(buffer: Buffer, signature: { bytes: number[]; offset?: number }): boolean {
  const offset = signature.offset || 0;
  if (buffer.length < offset + signature.bytes.length) return false;
  return signature.bytes.every((byte, i) => buffer[offset + i] === byte);
}

function isDangerousFile(buffer: Buffer): string | null {
  for (const danger of DANGEROUS_MAGIC_BYTES) {
    if (matchesMagicBytes(buffer, { bytes: danger.bytes })) {
      return danger.name;
    }
  }
  return null;
}

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

/**
 * Validate file uploads using magic byte detection.
 * Rejects dangerous file types regardless of extension.
 */
export function validateFileUpload(category: AllowedCategory) {
  const allowedExtensions = CATEGORY_EXTENSIONS[category];

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.file && !req.files) return next();

    const files = req.file ? [req.file] : (Array.isArray(req.files) ? req.files : []);

    for (const file of files) {
      const ext = getExtension(file.originalname);
      const buffer = file.buffer;

      // Check extension is allowed
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({
          error: `File type .${ext} is not allowed. Accepted: ${allowedExtensions.join(", ")}`,
        });
      }

      // Skip magic byte checks for CSV (text files don't have magic bytes)
      if (ext === "csv") continue;

      if (!buffer || buffer.length < 4) {
        return res.status(400).json({ error: "File is empty or too small" });
      }

      // Check for dangerous file types (e.g., .exe disguised as .pdf)
      const dangerType = isDangerousFile(buffer);
      if (dangerType) {
        console.error(JSON.stringify({
          event: "dangerous_file_upload_blocked",
          detectedType: dangerType,
          claimedExtension: ext,
          filename: file.originalname,
          size: file.size,
          ts: new Date().toISOString(),
        }));
        return res.status(400).json({
          error: "File content does not match its extension. Upload rejected.",
        });
      }

      // Verify magic bytes match the claimed extension
      const expectedSignatures = MAGIC_BYTES[ext];
      if (expectedSignatures) {
        const matches = expectedSignatures.every((sig) => matchesMagicBytes(buffer, sig));
        if (!matches) {
          return res.status(400).json({
            error: `File content does not match .${ext} format. Ensure the file is a valid ${ext.toUpperCase()}.`,
          });
        }
      }
    }

    next();
  };
}

/**
 * Validate CSV has required headers.
 */
export function validateCSVHeaders(requiredHeaders: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) return next();

    const ext = getExtension(req.file.originalname);
    if (ext !== "csv") return next();

    const content = req.file.buffer.toString("utf-8");
    const firstLine = content.split(/\r?\n/)[0];
    if (!firstLine) {
      return res.status(400).json({ error: "CSV file is empty" });
    }

    const headers = firstLine.split(",").map((h) => h.trim().toLowerCase().replace(/^"/, "").replace(/"$/, ""));
    const missing = requiredHeaders.filter((rh) => !headers.includes(rh.toLowerCase()));

    if (missing.length > 0) {
      return res.status(400).json({
        error: `CSV is missing required headers: ${missing.join(", ")}`,
        providedHeaders: headers,
        requiredHeaders,
      });
    }

    next();
  };
}
