import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { downloadWithAuth } from "@/lib/export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
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
  X,
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

function certLevelFromScore(score: number): string {
  if (score >= 90) return "PLATINUM";
  if (score >= 75) return "GOLD";
  if (score >= 55) return "SILVER";
  return "AT_RISK";
}

export default function CertificationPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [quarterKey, setQuarterKey] = useState(getCurrentQuarterKey());
  const quarterOptions = getQuarterOptions();
  const [levelFilter, setLevelFilter] = useState<string>("");

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

  const handleExportPdf = async () => {
    await downloadWithAuth(
      `/api/intelligence/certification/export.pdf?quarter_key=${quarterKey}`,
      `UCM_Certification_${quarterKey}.pdf`,
      "application/pdf",
      rawAuthFetch,
      (msg) => toast({ title: "Error", description: msg, variant: "destructive" }),
    );
  };

  const clinicsByLevel = useMemo(() => {
    return {
      PLATINUM: certs.filter((c: any) => (c.certLevel || certLevelFromScore(c.score)) === "PLATINUM"),
      GOLD: certs.filter((c: any) => (c.certLevel || certLevelFromScore(c.score)) === "GOLD"),
      SILVER: certs.filter((c: any) => (c.certLevel || certLevelFromScore(c.score)) === "SILVER"),
      AT_RISK: certs.filter((c: any) => {
        const lvl = c.certLevel || certLevelFromScore(c.score);
        return lvl === "AT_RISK" || lvl === "BRONZE";
      }),
    };
  }, [certs]);

  function handleLevelClick(level: string) {
    const clinicsInLevel = clinicsByLevel[level as keyof typeof clinicsByLevel] || [];
    if (clinicsInLevel.length === 1 && clinicsInLevel[0].clinicId) {
      navigate(`/clinics/${clinicsInLevel[0].clinicId}`);
      return;
    }
    setLevelFilter(levelFilter === level ? "" : level);
  }

  const filteredCerts = useMemo(() => {
    if (!levelFilter) return certs;
    return clinicsByLevel[levelFilter as keyof typeof clinicsByLevel] || [];
  }, [certs, levelFilter, clinicsByLevel]);

  const filterLabel = levelFilter === "PLATINUM" ? "Platinum" : levelFilter === "GOLD" ? "Gold" : levelFilter === "SILVER" ? "Silver" : levelFilter === "AT_RISK" ? "At Risk" : "";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="certification-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Award className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Clinic Certification</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quarterKey} onValueChange={(v) => { setQuarterKey(v); setLevelFilter(""); }}>
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card
            data-testid="card-platinum"
            className={`cursor-pointer transition-all ${levelFilter === "PLATINUM" ? "ring-2 ring-blue-500/40 bg-blue-500/5" : "hover:ring-1 hover:ring-blue-500/20"}`}
            onClick={() => handleLevelClick("PLATINUM")}
          >
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Platinum</CardTitle>
              <Award className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-platinum-count">{summary.platinum}</div>
              <p className="text-xs text-muted-foreground">Score 90+</p>
            </CardContent>
          </Card>
          <Card
            data-testid="card-gold"
            className={`cursor-pointer transition-all ${levelFilter === "GOLD" ? "ring-2 ring-yellow-500/40 bg-yellow-500/5" : "hover:ring-1 hover:ring-yellow-500/20"}`}
            onClick={() => handleLevelClick("GOLD")}
          >
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Gold</CardTitle>
              <Award className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400" data-testid="text-gold-count">{summary.gold}</div>
              <p className="text-xs text-muted-foreground">Score 75-89</p>
            </CardContent>
          </Card>
          <Card
            data-testid="card-silver"
            className={`cursor-pointer transition-all ${levelFilter === "SILVER" ? "ring-2 ring-gray-400/40 bg-gray-400/5" : "hover:ring-1 hover:ring-gray-400/20"}`}
            onClick={() => handleLevelClick("SILVER")}
          >
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Silver</CardTitle>
              <Award className="h-4 w-4 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-500 dark:text-gray-400" data-testid="text-silver-count">{summary.silver}</div>
              <p className="text-xs text-muted-foreground">Score 55-74</p>
            </CardContent>
          </Card>
          <Card
            data-testid="card-at-risk"
            className={`cursor-pointer transition-all ${levelFilter === "AT_RISK" ? "ring-2 ring-red-500/40 bg-red-500/5" : "hover:ring-1 hover:ring-red-500/20"}`}
            onClick={() => handleLevelClick("AT_RISK")}
          >
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
          <CardTitle className="text-base">
            {levelFilter ? `${filterLabel} Clinics — ${quarterKey}` : `Certification Results — ${quarterKey}`}
          </CardTitle>
          <div className="flex items-center gap-2">
            {levelFilter && (
              <Button variant="ghost" size="sm" onClick={() => setLevelFilter("")} data-testid="button-clear-level-filter">
                <X className="w-3 h-3 mr-1" />
                Clear
              </Button>
            )}
            <Badge variant="secondary">
              {levelFilter ? `${filteredCerts.length} of ${certs.length} clinics` : `${certs.length} clinics`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {certQuery.isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : filteredCerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="text-no-certs">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground mb-3" />
              {levelFilter ? (
                <>
                  <p className="text-sm text-muted-foreground">No {filterLabel.toLowerCase()} clinics for this quarter.</p>
                  <Button variant="link" size="sm" onClick={() => setLevelFilter("")} className="mt-2">Show all clinics</Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">No certification data for this quarter.</p>
                  <p className="text-xs text-muted-foreground mt-1">Click "Compute & Save" to generate certifications.</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredCerts.map((c: any, i: number) => {
                const globalIndex = certs.indexOf(c);
                return (
                  <button
                    key={`${c.clinicId}-${i}`}
                    className="flex items-center gap-3 p-3 rounded-md border flex-wrap w-full text-left transition-colors cursor-pointer hover:bg-muted/50"
                    onClick={() => c.clinicId && navigate(`/clinics/${c.clinicId}`)}
                    data-testid={`cert-row-${c.clinicId}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm font-medium w-8 text-right text-muted-foreground">#{globalIndex + 1}</span>
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
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
