import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { downloadWithAuth } from "@/lib/export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";

function getDefaultDates() {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
  return { from, to };
}

function scoreColor(score: number) {
  if (score >= 90) return "text-green-600 dark:text-green-400";
  if (score >= 70) return "text-yellow-600 dark:text-yellow-400";
  if (score >= 50) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function scoreBadgeVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 80) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

export default function AuditShieldPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const defaults = getDefaultDates();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);

  const auditQuery = useQuery({
    queryKey: ["/api/intelligence/audit", dateFrom, dateTo],
    queryFn: () => apiFetch(`/api/intelligence/audit?dateFrom=${dateFrom}&dateTo=${dateTo}`, token),
    enabled: !!dateFrom && !!dateTo,
  });

  const data = auditQuery.data;
  const results = data?.results || [];
  const avgScore = data?.avgScore ?? 0;

  const handleExportPdf = async () => {
    await downloadWithAuth(
      `/api/intelligence/audit/export.pdf?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      `UCM_AuditShield_${dateFrom}_${dateTo}.pdf`,
      "application/pdf",
      rawAuthFetch,
      (msg) => toast({ title: "Error", description: msg, variant: "destructive" }),
    );
  };

  const highRisk = results.filter((r: any) => r.score < 50);
  const moderate = results.filter((r: any) => r.score >= 50 && r.score < 80);
  const compliant = results.filter((r: any) => r.score >= 80);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="audit-shield-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Audit Shield</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[150px]"
            data-testid="input-date-from"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[150px]"
            data-testid="input-date-to"
          />
          <Button variant="outline" onClick={handleExportPdf} data-testid="button-export-pdf">
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {auditQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card data-testid="card-avg-score">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Score</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${scoreColor(avgScore)}`} data-testid="text-avg-score">
                {avgScore.toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground">{results.length} clinics evaluated</p>
            </CardContent>
          </Card>
          <Card data-testid="card-compliant">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Compliant</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-compliant-count">{compliant.length}</div>
              <p className="text-xs text-muted-foreground">Score 80%+</p>
            </CardContent>
          </Card>
          <Card data-testid="card-moderate">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Needs Attention</CardTitle>
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400" data-testid="text-moderate-count">{moderate.length}</div>
              <p className="text-xs text-muted-foreground">Score 50-79%</p>
            </CardContent>
          </Card>
          <Card data-testid="card-high-risk">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">High Risk</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-high-risk-count">{highRisk.length}</div>
              <p className="text-xs text-muted-foreground">Score below 50%</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card data-testid="card-audit-results">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Evidence Completeness by Clinic</CardTitle>
          <Badge variant="secondary">{results.length} clinics</Badge>
        </CardHeader>
        <CardContent>
          {auditQuery.isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="text-no-results">
              <Shield className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No audit data available for this period.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((r: any) => (
                <div
                  key={r.clinicId}
                  className="flex items-start gap-3 p-3 rounded-md border flex-wrap"
                  data-testid={`audit-row-${r.clinicId}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{r.clinicName}</p>
                      <Badge variant={scoreBadgeVariant(r.score)} data-testid={`badge-score-${r.clinicId}`}>
                        {r.score.toFixed(1)}%
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                      <span>{r.completeTrips}/{r.totalTrips} trips complete</span>
                    </div>
                    {r.missingBreakdown && r.missingBreakdown.length > 0 && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {r.missingBreakdown.map((m: any) => (
                          <Badge key={m.category} variant="outline" className="text-xs">
                            {m.category}: {m.count}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="w-24 flex-shrink-0">
                    <div className="w-full h-2 rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${r.score >= 80 ? "bg-green-500" : r.score >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(r.score, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
