import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Award,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";

function getCurrentQuarterKey() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

function getQuarterOptions() {
  const now = new Date();
  const year = now.getFullYear();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  const options: string[] = [];
  for (let y = year; y >= year - 1; y--) {
    const maxQ = y === year ? q : 4;
    for (let i = maxQ; i >= 1; i--) {
      options.push(`${y}-Q${i}`);
    }
  }
  return options;
}

function certLevelVariant(level: string) {
  switch (level) {
    case "PLATINUM": return "default";
    case "GOLD": return "secondary";
    case "SILVER": return "outline";
    default: return "destructive";
  }
}

function certLevelColor(level: string) {
  switch (level) {
    case "PLATINUM": return "text-blue-600 dark:text-blue-400";
    case "GOLD": return "text-yellow-600 dark:text-yellow-400";
    case "SILVER": return "text-gray-500 dark:text-gray-400";
    default: return "text-red-600 dark:text-red-400";
  }
}

export default function CertificationPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [quarterKey, setQuarterKey] = useState(getCurrentQuarterKey());
  const quarterOptions = getQuarterOptions();

  const certQuery = useQuery({
    queryKey: ["/api/intelligence/certification", quarterKey],
    queryFn: () => apiFetch(`/api/intelligence/certification?quarter_key=${quarterKey}`, token),
  });

  const computeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/intelligence/certification/compute", { quarterKey }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/certification"] });
      toast({ title: `Certifications computed and saved (${data.saved} clinics)` });
    },
    onError: () => toast({ title: "Failed to compute certifications", variant: "destructive" }),
  });

  const data = certQuery.data;
  const certs = data?.certifications || [];
  const summary = data?.summary;

  const handleExportPdf = () => {
    window.open(`/api/intelligence/certification/export.pdf?quarter_key=${quarterKey}`, "_blank");
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="certification-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Award className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Clinic Certification</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quarterKey} onValueChange={setQuarterKey}>
            <SelectTrigger className="w-[130px]" data-testid="select-quarter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {quarterOptions.map((q) => (
                <SelectItem key={q} value={q}>{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => computeMutation.mutate()}
            disabled={computeMutation.isPending}
            data-testid="button-compute"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${computeMutation.isPending ? "animate-spin" : ""}`} />
            Compute & Save
          </Button>
          <Button variant="outline" onClick={handleExportPdf} data-testid="button-export-pdf">
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {certQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-platinum">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Platinum</CardTitle>
              <Award className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-platinum-count">{summary.platinum}</div>
              <p className="text-xs text-muted-foreground">Score 90+</p>
            </CardContent>
          </Card>
          <Card data-testid="card-gold">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Gold</CardTitle>
              <Award className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400" data-testid="text-gold-count">{summary.gold}</div>
              <p className="text-xs text-muted-foreground">Score 75-89</p>
            </CardContent>
          </Card>
          <Card data-testid="card-silver">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Silver</CardTitle>
              <Award className="h-4 w-4 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-500 dark:text-gray-400" data-testid="text-silver-count">{summary.silver}</div>
              <p className="text-xs text-muted-foreground">Score 55-74</p>
            </CardContent>
          </Card>
          <Card data-testid="card-at-risk">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">At Risk</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-at-risk-count">{summary.atRisk}</div>
              <p className="text-xs text-muted-foreground">Score below 55</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card data-testid="card-cert-list">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Certification Results — {quarterKey}</CardTitle>
          <Badge variant="secondary">{certs.length} clinics</Badge>
        </CardHeader>
        <CardContent>
          {certQuery.isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : certs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="text-no-certs">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No certification data for this quarter.</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Compute & Save" to generate certifications.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {certs.map((c: any, i: number) => (
                <div
                  key={`${c.clinicId}-${i}`}
                  className="flex items-center gap-3 p-3 rounded-md border flex-wrap"
                  data-testid={`cert-row-${c.clinicId}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm font-medium w-8 text-right text-muted-foreground">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{c.clinicName}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span>TRI: {c.breakdown?.tri?.toFixed(1) ?? "—"}</span>
                        <span>Completion: {c.breakdown?.completionRate?.toFixed(1) ?? "—"}%</span>
                        <span>On-Time: {c.breakdown?.onTimeRate?.toFixed(1) ?? "—"}%</span>
                        <span>Audit: {c.breakdown?.auditReadiness?.toFixed(1) ?? "—"}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-bold ${certLevelColor(c.certLevel)}`}>
                      {c.score?.toFixed(1)}
                    </span>
                    <Badge variant={certLevelVariant(c.certLevel) as any} data-testid={`badge-cert-level-${c.clinicId}`}>
                      {c.certLevel}
                    </Badge>
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
