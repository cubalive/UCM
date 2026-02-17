export async function addWatermarkToPdf(originalPdf: Buffer, watermarkText: string): Promise<Buffer> {
  const pdfStr = originalPdf.toString("binary");
  const eofIdx = pdfStr.lastIndexOf("%%EOF");
  if (eofIdx === -1) {
    return originalPdf;
  }

  const wmComment = `\n% Watermark: ${watermarkText}\n% Generated: ${new Date().toISOString()}\n`;
  const before = Buffer.from(pdfStr.substring(0, eofIdx), "binary");
  const wmBuf = Buffer.from(wmComment, "utf-8");
  const after = Buffer.from(pdfStr.substring(eofIdx), "binary");

  return Buffer.concat([before, wmBuf, after]);
}
