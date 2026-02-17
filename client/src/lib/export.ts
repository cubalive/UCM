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
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export async function downloadWithAuth(
  url: string,
  filename: string,
  token: string | null,
  options?: { method?: string; body?: unknown; onError?: (msg: string) => void },
): Promise<boolean> {
  if (!token) {
    options?.onError?.("Session expired — please log in again");
    return false;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  try {
    const cityId = localStorage.getItem("ucm_working_city_id");
    if (cityId) headers["X-City-Id"] = cityId;
  } catch {}
  if (options?.body) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: options?.method || "GET",
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    options?.onError?.("Network error — check your connection");
    return false;
  }

  if (res.status === 401) {
    options?.onError?.("Session expired — please log in again");
    return false;
  }
  if (res.status === 403) {
    options?.onError?.("You do not have access to this download");
    return false;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = "Download failed";
    try { msg = JSON.parse(text).message || msg; } catch {}
    options?.onError?.(msg);
    return false;
  }

  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
  }, 200);
  return true;
}
