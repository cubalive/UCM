import archiver from "archiver";
import { db } from "../db";
import { tripPdfs } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { storage } from "../storage";
import { processPdfJob } from "./pdfJobProcessor";

interface BatchPdfPayload {
  tripIds: number[];
  companyId?: number | null;
  userId?: number;
}

export async function processBatchPdfJob(job: any): Promise<Record<string, unknown>> {
  const payload = job.payload as BatchPdfPayload;
  const { tripIds, companyId } = payload;

  if (!tripIds || tripIds.length === 0) throw new Error("No tripIds provided");
  if (tripIds.length > 50) throw new Error("Max 50 trips per batch");

  const generated: string[] = [];
  const errors: Array<{ tripId: number; error: string }> = [];

  for (const tripId of tripIds) {
    try {
      const existing = await db
        .select()
        .from(tripPdfs)
        .where(eq(tripPdfs.tripId, tripId))
        .orderBy(desc(tripPdfs.createdAt))
        .limit(1);

      if (existing.length === 0) {
        await processPdfJob({
          id: `${job.id}_sub_${tripId}`,
          payload: { tripId, companyId },
          type: "pdf_trip_details",
          attempts: 1,
        });
      }
      generated.push(String(tripId));
    } catch (err: any) {
      errors.push({ tripId, error: err.message });
    }
  }

  const zipChunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("data", (chunk: Buffer) => zipChunks.push(chunk));
    archive.on("end", () => resolve());
    archive.on("error", (err: Error) => reject(err));

    const addPdfs = async () => {
      for (const tripId of tripIds) {
        try {
          const pdfRows = await db
            .select()
            .from(tripPdfs)
            .where(eq(tripPdfs.tripId, tripId))
            .orderBy(desc(tripPdfs.createdAt))
            .limit(1);

          if (pdfRows.length > 0) {
            const buffer = Buffer.from(pdfRows[0].bytes, "base64");
            const trip = await storage.getTrip(tripId);
            const filename = `trip-${trip?.publicId || tripId}.pdf`;
            archive.append(buffer, { name: filename });
          }
        } catch {}
      }
      archive.finalize();
    };

    addPdfs().catch(reject);
  });

  const zipBuffer = Buffer.concat(zipChunks);
  const base64Zip = zipBuffer.toString("base64");

  return {
    tripCount: tripIds.length,
    generated: generated.length,
    errors: errors.length,
    zipSizeBytes: zipBuffer.length,
    zipBase64: base64Zip,
    storedAt: new Date().toISOString(),
  };
}
