import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { downloadWithAuth } from "@/lib/export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  ArrowUpDown,
  Filter,
  X,
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

function riskLabel(score: number) {
  if (score >= 80) return "Compliant";
  if (score >= 50) return "Needs Attention";
  return "High Risk";
}

export default function AuditShieldPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const defaults = getDefaultDates();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);

  const [searchText, setSearchText] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("score_asc");
  const [showFilters, setShowFilters] = useState(false);

  const auditQuery = useQuery({
    queryKey: ["/api/intelligence/audit", dateFrom, dateTo],
    queryFn: () => apiFetch(`/api/intelligence/audit?dateFrom=${dateFrom}&dateTo=${dateTo}`, token),
    enabled: !!dateFrom && !!dateTo,
  });

  const data = auditQuery.data;
  const results = data?.results || [];
  const avgScore = data?.avgScore ?? 0;

  const filteredResults = useMemo(() => {
    let filtered = [...results];

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      filtered = filtered.filter((r: any) =>
        r.clinicName?.toLowerCase().includes(q)
      );
    }

    if (riskFilter === "compliant") {
      filtered = filtered.filter((r: any) => r.score >= 80);
    } else if (riskFilter === "attention") {
      filtered = filtered.filter((r: any) => r.score >= 50 && r.score < 80);
    } else if (riskFilter === "high_risk") {
      filtered = filtered.filter((r: any) => r.score < 50);
    }

    if (sortBy === "score_asc") {
      filtered.sort((a: any, b: any) => a.score - b.score);
    } else if (sortBy === "score_desc") {
      filtered.sort((a: any, b: any) => b.score - a.score);
    } else if (sortBy === "name_asc") {
      filtered.sort((a: any, b: any) => (a.clinicName || "").localeCompare(b.clinicName || ""));
    } else if (sortBy === "name_desc") {
      filtered.sort((a: any, b: any) => (b.clinicName || "").localeCompare(a.clinicName || ""));
    } else if (sortBy === "trips_desc") {
      filtered.sort((a: any, b: any) => (b.totalTrips || 0) - (a.totalTrips || 0));
    }

    return filtered;
  }, [results, searchText, riskFilter, sortBy]);

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

  const hasActiveFilters = searchText.trim() || riskFilter;

  function clearFilters() {
    setSearchText("");
    setRiskFilter("");
    setSortBy("score_asc");
  }

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card
            data-testid="card-avg-score"
            className={`cursor-pointer transition-all ${riskFilter === "" ? "ring-2 ring-primary/30" : "hover:ring-1 hover:ring-primary/20"}`}
            onClick={() => setRiskFilter("")}
          >
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
          <Card
            data-testid="card-compliant"
            className={`cursor-pointer transition-all ${riskFilter === "compliant" ? "ring-2 ring-green-500/40" : "hover:ring-1 hover:ring-green-500/20"}`}
            onClick={() => setRiskFilter(riskFilter === "compliant" ? "" : "compliant")}
          >
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Compliant</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-compliant-count">{compliant.length}</div>
              <p className="text-xs text-muted-foreground">Score 80%+</p>
            </CardContent>
          </Card>
          <Card
            data-testid="card-moderate"
            className={`cursor-pointer transition-all ${riskFilter === "attention" ? "ring-2 ring-yellow-500/40" : "hover:ring-1 hover:ring-yellow-500/20"}`}
            onClick={() => setRiskFilter(riskFilter === "attention" ? "" : "attention")}
          >
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Needs Attention</CardTitle>
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400" data-testid="text-moderate-count">{moderate.length}</div>
              <p className="text-xs text-muted-foreground">Score 50-79%</p>
            </CardContent>
          </Card>
          <Card
            data-testid="card-high-risk"
            className={`cursor-pointer transition-all ${riskFilter === "high_risk" ? "ring-2 ring-red-500/40" : "hover:ring-1 hover:ring-red-500/20"}`}
            onClick={() => setRiskFilter(riskFilter === "high_risk" ? "" : "high_risk")}
          >
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
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Evidence Completeness by Clinic</CardTitle>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="w-3 h-3 mr-1" />
                Clear
              </Button>
            )}
            <Badge variant="secondary">{filteredResults.length} of {results.length} clinics</Badge>
            <Button
              variant={showFilters ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              data-testid="button-toggle-filters"
            >
              <Filter className="w-4 h-4 mr-1" />
              Filters
            </Button>
          </div>
        </CardHeader>

        {showFilters && (
          <div className="px-6 pb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search clinic name..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pl-8"
                  data-testid="input-search-clinic"
                />
              </div>

              <Select value={riskFilter || "__all__"} onValueChange={(v) => setRiskFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-[160px]" data-testid="select-risk-filter">
                  <SelectValue placeholder="Risk Level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Levels</SelectItem>
                  <SelectItem value="compliant">Compliant (80%+)</SelectItem>
                  <SelectItem value="attention">Needs Attention (50-79%)</SelectItem>
                  <SelectItem value="high_risk">High Risk (&lt;50%)</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[180px]" data-testid="select-sort-by">
                  <ArrowUpDown className="w-3 h-3 mr-1" />
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="score_asc">Score: Low to High</SelectItem>
                  <SelectItem value="score_desc">Score: High to Low</SelectItem>
                  <SelectItem value="name_asc">Name: A to Z</SelectItem>
                  <SelectItem value="name_desc">Name: Z to A</SelectItem>
                  <SelectItem value="trips_desc">Most Trips</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <CardContent>
          {auditQuery.isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="text-no-results">
              <Shield className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters ? "No clinics match the current filters." : "No audit data available for this period."}
              </p>
              {hasActiveFilters && (
                <Button variant="link" size="sm" onClick={clearFilters} className="mt-2">
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredResults.map((r: any) => (
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
                      <Badge variant="outline" className="text-[10px] py-0">{riskLabel(r.score)}</Badge>
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
