export function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = typeof val === "object" ? JSON.stringify(val) : String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "";
  const headers = columns ?? Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return "\ufeff" + lines.join("\n");
}

export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function buildTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export async function downloadWithAuth(
  url: string,
  filename: string,
  mimeType: string,
  apiFetchLike: (url: string, init?: RequestInit) => Promise<Response>,
  toast?: (msg: string) => void,
): Promise<boolean> {
  let res: Response;
  try {
    res = await apiFetchLike(url);
  } catch {
    toast?.("Network error — check your connection");
    return false;
  }

  if (res.status === 401) {
    toast?.("Session expired. Please login again.");
    return false;
  }
  if (res.status === 403) {
    toast?.("No access.");
    return false;
  }
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      const text = await res.text();
      const parsed = JSON.parse(text);
      if (parsed.message || parsed.error) msg = parsed.message || parsed.error;
    } catch {}
    toast?.(msg);
    return false;
  }

  const blob = await res.blob();
  const safeBlob = mimeType ? new Blob([blob], { type: mimeType }) : blob;

  const objectUrl = URL.createObjectURL(safeBlob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  return true;
}
