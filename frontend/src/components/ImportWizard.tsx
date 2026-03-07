import { useState, useRef } from "react";
import { importApi } from "../lib/api";

type Step = "upload" | "preview" | "confirm" | "result";
type Entity = "patients" | "trips" | "drivers";

interface ColumnMapping {
  sourceColumn: string;
  targetField: string;
  confidence: string;
}

interface ImportResult {
  success: boolean;
  entity: string;
  totalRows: number;
  inserted: number;
  skipped: number;
  duplicates: number;
  errors: Array<{ row: number; field: string; value: string | null; message: string; severity: string }>;
  warnings: Array<{ row: number; field: string; value: string | null; message: string; severity: string }>;
  dryRun: boolean;
  durationMs: number;
}

export function ImportWizard({ onClose }: { onClose?: () => void }) {
  const [step, setStep] = useState<Step>("upload");
  const [entity, setEntity] = useState<Entity>("patients");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setLoading(true);
    try {
      const prev = await importApi.preview(f, entity);
      setPreview(prev);
      setStep("preview");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDryRun = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await importApi.execute(file, entity, { dryRun: true });
      setResult(res);
      setStep("confirm");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await importApi.execute(file, entity, { dryRun: false });
      setResult(res);
      setStep("result");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div style={{ background: "white", borderRadius: 8, padding: 24, maxWidth: 800, margin: "0 auto", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Import Data</h2>
        {onClose && <button onClick={onClose} style={closeBtnStyle}>X</button>}
      </div>

      {/* Step indicators */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["upload", "preview", "confirm", "result"] as Step[]).map((s, i) => (
          <div key={s} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: (["upload", "preview", "confirm", "result"] as Step[]).indexOf(step) >= i ? "#3b82f6" : "#e5e7eb",
          }} />
        ))}
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 12, marginBottom: 16, color: "#991b1b", fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Data Type</label>
            <select value={entity} onChange={(e) => setEntity(e.target.value as Entity)} style={selectStyle}>
              <option value="patients">Patients / Members</option>
              <option value="drivers">Drivers</option>
              <option value="trips">Trips</option>
            </select>
          </div>

          <div style={{ border: "2px dashed #d1d5db", borderRadius: 8, padding: 40, textAlign: "center", cursor: "pointer" }}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.tsv,.txt" onChange={handleFileSelect} style={{ display: "none" }} />
            <div style={{ fontSize: 32, marginBottom: 8 }}>+</div>
            <p style={{ color: "#6b7280", margin: 0 }}>
              {loading ? "Analyzing file..." : "Click to upload CSV or Excel file"}
            </p>
            <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 8 }}>
              Supports: CSV, TSV, XLSX. Max 10MB.
            </p>
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            {(["patients", "trips", "drivers"] as Entity[]).map((e) => (
              <a key={e} href={importApi.downloadTemplate(e)} download style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}>
                Download {e} template
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Preview column mapping */}
      {step === "preview" && preview && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <strong>{preview.fileName}</strong> - {preview.totalRows} rows detected
          </div>

          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Column Mapping</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Your Column</th>
                <th style={thStyle}>Maps To</th>
                <th style={thStyle}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {preview.mappedColumns.map((m: ColumnMapping, i: number) => (
                <tr key={i}>
                  <td style={tdStyle}>{m.sourceColumn}</td>
                  <td style={tdStyle}>{m.targetField}</td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: "2px 6px", borderRadius: 4, fontSize: 11,
                      background: m.confidence === "exact" ? "#dcfce7" : m.confidence === "alias" ? "#dbeafe" : "#fef3c7",
                      color: m.confidence === "exact" ? "#166534" : m.confidence === "alias" ? "#1e40af" : "#92400e",
                    }}>
                      {m.confidence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {preview.unmappedColumns.length > 0 && (
            <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
              Unmapped columns (will be skipped): {preview.unmappedColumns.join(", ")}
            </p>
          )}

          {preview.sampleRows.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, marginTop: 16, marginBottom: 8 }}>Sample Data (first {preview.sampleRows.length} rows)</h3>
              <div style={{ overflow: "auto", maxHeight: 200 }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {preview.headers.map((h: string) => (
                        <th key={h} style={{ ...thStyle, fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row: Record<string, string>, i: number) => (
                      <tr key={i}>
                        {preview.headers.map((h: string) => (
                          <td key={h} style={{ ...tdStyle, fontSize: 12, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {row[h] || ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button onClick={reset} style={secondaryBtnStyle}>Back</button>
            <button onClick={handleDryRun} disabled={loading} style={primaryBtnStyle}>
              {loading ? "Validating..." : "Validate (Dry Run)"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm after dry run */}
      {step === "confirm" && result && (
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Validation Results (Dry Run)</h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <StatBox label="Total Rows" value={result.totalRows} />
            <StatBox label="Would Insert" value={result.inserted} color="#16a34a" />
            <StatBox label="Duplicates" value={result.duplicates} color="#f59e0b" />
            <StatBox label="Errors" value={result.errors.length} color="#dc2626" />
          </div>

          {result.errors.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, color: "#dc2626", marginBottom: 4 }}>Errors ({result.errors.length})</h4>
              <div style={{ maxHeight: 150, overflow: "auto", fontSize: 12, background: "#fef2f2", borderRadius: 6, padding: 8 }}>
                {result.errors.slice(0, 20).map((e, i) => (
                  <div key={i} style={{ marginBottom: 2 }}>
                    Row {e.row}: {e.field ? `[${e.field}] ` : ""}{e.message}
                    {e.value ? ` (got: "${e.value}")` : ""}
                  </div>
                ))}
                {result.errors.length > 20 && <div>...and {result.errors.length - 20} more</div>}
              </div>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, color: "#f59e0b", marginBottom: 4 }}>Warnings ({result.warnings.length})</h4>
              <div style={{ maxHeight: 100, overflow: "auto", fontSize: 12, background: "#fffbeb", borderRadius: 6, padding: 8 }}>
                {result.warnings.slice(0, 10).map((w, i) => (
                  <div key={i} style={{ marginBottom: 2 }}>
                    Row {w.row}: {w.message}
                  </div>
                ))}
                {result.warnings.length > 10 && <div>...and {result.warnings.length - 10} more</div>}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button onClick={reset} style={secondaryBtnStyle}>Cancel</button>
            <button onClick={handleExecute} disabled={loading || result.inserted === 0} style={primaryBtnStyle}>
              {loading ? "Importing..." : `Import ${result.inserted} Records`}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Final result */}
      {step === "result" && result && (
        <div>
          <div style={{
            textAlign: "center", padding: 20, marginBottom: 16,
            background: result.success ? "#f0fdf4" : "#fef2f2",
            borderRadius: 8,
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>{result.success ? "OK" : "!"}</div>
            <h3 style={{ margin: 0, color: result.success ? "#166534" : "#991b1b" }}>
              {result.success ? "Import Completed" : "Import Completed with Errors"}
            </h3>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <StatBox label="Total Rows" value={result.totalRows} />
            <StatBox label="Inserted" value={result.inserted} color="#16a34a" />
            <StatBox label="Duplicates" value={result.duplicates} color="#f59e0b" />
            <StatBox label="Errors" value={result.errors.length} color="#dc2626" />
          </div>

          <p style={{ fontSize: 12, color: "#6b7280" }}>
            Completed in {(result.durationMs / 1000).toFixed(1)}s
          </p>

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button onClick={reset} style={primaryBtnStyle}>Import More Data</button>
            {onClose && <button onClick={onClose} style={secondaryBtnStyle}>Close</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: "#f9fafb", borderRadius: 6, padding: 12, textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || "#111827" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#6b7280" }}>{label}</div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const selectStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 };
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #e5e7eb", fontSize: 12, color: "#6b7280" };
const tdStyle: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f3f4f6" };
const primaryBtnStyle: React.CSSProperties = { padding: "8px 20px", borderRadius: 6, border: "none", background: "#3b82f6", color: "white", cursor: "pointer", fontSize: 14 };
const secondaryBtnStyle: React.CSSProperties = { padding: "8px 20px", borderRadius: 6, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontSize: 14 };
const closeBtnStyle: React.CSSProperties = { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#9ca3af" };
