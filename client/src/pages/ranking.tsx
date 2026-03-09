import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { downloadWithAuth } from "@/lib/export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trophy,
  Download,
  RefreshCw,
  ArrowUp,
  Medal,
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

function percentileColor(p: number) {
  if (p >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (p >= 75) return "text-green-600 dark:text-green-400";
  if (p >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

export default function RankingPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [quarterKey, setQuarterKey] = useState(getCurrentQuarterKey());
  const [scope, setScope] = useState("national");
  const [metricKey, setMetricKey] = useState("tri");
  const [stateFilter, setStateFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const quarterOptions = getQuarterOptions();

  const scopeParams = scope === "state" && stateFilter ? `&state=${stateFilter}` : scope === "city" && cityFilter ? `&city=${cityFilter}` : "";

  const rankQuery = useQuery({
    queryKey: ["/api/intelligence/ranking", quarterKey, scope, metricKey, stateFilter, cityFilter],
    queryFn: () => apiFetch(`/api/intelligence/ranking?quarter_key=${quarterKey}&scope=${scope}&metric_key=${metricKey}${scopeParams}`, token),
  });

  const computeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/intelligence/ranking/compute", {
      quarterKey, scope, metricKey,
      ...(scope === "state" && stateFilter ? { state: stateFilter } : {}),
      ...(scope === "city" && cityFilter ? { city: cityFilter } : {}),
    }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/ranking"] });
      toast({ title: `Rankings computed and saved (${data.saved} entries)` });
    },
    onError: () => toast({ title: "Failed to compute rankings", variant: "destructive" }),
  });

  const entries = rankQuery.data?.entries || [];

  const handleExportPdf = async () => {
    await downloadWithAuth(
      `/api/intelligence/ranking/export.pdf?quarter_key=${quarterKey}&scope=${scope}&metric_key=${metricKey}${scopeParams}`,
      `UCM_Ranking_${quarterKey}_${scope}.pdf`,
      "application/pdf",
      rawAuthFetch,
      (msg) => toast({ title: "Error", description: msg, variant: "destructive" }),
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="ranking-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Trophy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Clinic Rankings</h1>
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
          <Select value={scope} onValueChange={(v) => { setScope(v); setStateFilter(""); setCityFilter(""); }}>
            <SelectTrigger className="w-[130px]" data-testid="select-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="national">National</SelectItem>
              <SelectItem value="state">State</SelectItem>
              <SelectItem value="city">City</SelectItem>
            </SelectContent>
          </Select>
          {scope === "state" && (
            <Input
              placeholder="State (e.g. TX)"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="w-[120px]"
              data-testid="input-state-filter"
            />
          )}
          {scope === "city" && (
            <Input
              placeholder="City name"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="w-[140px]"
              data-testid="input-city-filter"
            />
          )}
          <Select value={metricKey} onValueChange={setMetricKey}>
            <SelectTrigger className="w-[110px]" data-testid="select-metric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tri">TRI</SelectItem>
              <SelectItem value="cts">CTS</SelectItem>
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

      {rankQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : entries.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {entries.slice(0, 3).map((e: any, i: number) => (
            <Card key={e.clinicId} data-testid={`card-top-${i + 1}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {i === 0 ? "1st Place" : i === 1 ? "2nd Place" : "3rd Place"}
                </CardTitle>
                <Medal className={`h-4 w-4 ${i === 0 ? "text-yellow-500" : i === 1 ? "text-gray-400" : "text-orange-400"}`} />
              </CardHeader>
              <CardContent>
                <p className="text-base font-semibold truncate">{e.clinicName}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xl font-bold">{e.score?.toFixed(1)}</span>
                  <Badge variant="secondary">P{e.percentile?.toFixed(0)}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card data-testid="card-ranking-list">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            Full Rankings — {quarterKey} ({scope}) by {metricKey.toUpperCase()}
          </CardTitle>
          <Badge variant="secondary">{entries.length} clinics</Badge>
        </CardHeader>
        <CardContent>
          {rankQuery.isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="text-no-rankings">
              <Trophy className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No ranking data for this quarter.</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Compute & Save" to generate rankings.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((e: any) => (
                <div
                  key={e.clinicId}
                  className="flex items-center gap-3 p-3 rounded-md border flex-wrap"
                  data-testid={`ranking-row-${e.clinicId}`}
                >
                  <span className="text-sm font-bold w-8 text-right text-muted-foreground">
                    #{e.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.clinicName}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>Completed: {e.payload?.completed ?? "—"}</span>
                      <span>On-Time: {e.payload?.onTime ?? "—"}</span>
                      <span>Late: {e.payload?.late ?? "—"}</span>
                      <span>No-Show: {e.payload?.noShow ?? "—"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold">{e.score?.toFixed(1)}</span>
                    <span className={`text-sm font-semibold ${percentileColor(e.percentile)}`}>
                      P{e.percentile?.toFixed(0)}
                    </span>
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
