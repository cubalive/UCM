import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BarChart3, Trophy, TrendingUp, MapPin } from "lucide-react";

function getDefaultDates() {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
  return { from, to };
}

function RankingsTab() {
  const { token } = useAuth();
  const defaults = getDefaultDates();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);

  const rankingsQuery = useQuery<any>({
    queryKey: ["/api/city-comparison/rankings", from, to],
    queryFn: () => apiFetch(`/api/city-comparison/rankings?from=${from}&to=${to}`, token),
  });

  const rankings = rankingsQuery.data?.rankings || [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
      </div>

      {rankingsQuery.isLoading ? <Skeleton className="h-64 w-full" /> : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Total Trips</TableHead>
                <TableHead>On-Time %</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Avg Rating</TableHead>
                <TableHead>Drivers</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rankings.map((r: any, i: number) => (
                <TableRow key={r.cityId}>
                  <TableCell>
                    <Badge variant={i === 0 ? "default" : "outline"} className={i === 0 ? "bg-yellow-500/20 text-yellow-400" : ""}>
                      #{i + 1}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{r.cityName}</TableCell>
                  <TableCell>{r.totalTrips || 0}</TableCell>
                  <TableCell>
                    <Badge variant={(r.onTimePercent || 0) >= 90 ? "default" : (r.onTimePercent || 0) >= 70 ? "secondary" : "destructive"}>
                      {(r.onTimePercent || 0).toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell>${((r.revenueCents || 0) / 100).toFixed(0)}</TableCell>
                  <TableCell>{(r.avgRating || 0).toFixed(1)}</TableCell>
                  <TableCell>{r.driverCount || 0}</TableCell>
                  <TableCell className="font-bold">{(r.compositeScore || 0).toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function BenchmarksTab() {
  const { token } = useAuth();
  const benchQuery = useQuery<any>({
    queryKey: ["/api/city-comparison/benchmarks"],
    queryFn: () => apiFetch("/api/city-comparison/benchmarks", token),
  });

  if (benchQuery.isLoading) return <Skeleton className="h-40 w-full" />;
  const b = benchQuery.data?.benchmarks;
  if (!b) return <p className="text-muted-foreground">No benchmark data</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Object.entries(b).map(([metric, data]: [string, any]) => (
        <Card key={metric}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground capitalize">{metric.replace(/_/g, " ")}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-bold">{typeof data.average === "number" ? data.average.toFixed(1) : data.average}</p>
            <p className="text-xs text-muted-foreground">Best: {data.best?.cityName || "—"} ({typeof data.best?.value === "number" ? data.best.value.toFixed(1) : data.best?.value})</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TrendsTab() {
  const { token } = useAuth();
  const defaults = getDefaultDates();
  const trendsQuery = useQuery<any>({
    queryKey: ["/api/city-comparison/trends"],
    queryFn: () => apiFetch(`/api/city-comparison/trends?from=${defaults.from}&to=${defaults.to}`, token),
  });

  if (trendsQuery.isLoading) return <Skeleton className="h-40 w-full" />;
  const trends = trendsQuery.data?.trends || [];

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>City</TableHead>
            <TableHead>Trip Trend</TableHead>
            <TableHead>Revenue Trend</TableHead>
            <TableHead>On-Time Trend</TableHead>
            <TableHead>Rating Trend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trends.map((t: any) => (
            <TableRow key={t.cityId}>
              <TableCell className="font-medium">{t.cityName}</TableCell>
              <TableCell><Badge variant={t.tripTrend >= 0 ? "default" : "destructive"}>{t.tripTrend >= 0 ? "+" : ""}{(t.tripTrend || 0).toFixed(1)}%</Badge></TableCell>
              <TableCell><Badge variant={t.revenueTrend >= 0 ? "default" : "destructive"}>{t.revenueTrend >= 0 ? "+" : ""}{(t.revenueTrend || 0).toFixed(1)}%</Badge></TableCell>
              <TableCell><Badge variant={t.onTimeTrend >= 0 ? "default" : "destructive"}>{t.onTimeTrend >= 0 ? "+" : ""}{(t.onTimeTrend || 0).toFixed(1)}%</Badge></TableCell>
              <TableCell><Badge variant={t.ratingTrend >= 0 ? "default" : "destructive"}>{t.ratingTrend >= 0 ? "+" : ""}{(t.ratingTrend || 0).toFixed(2)}</Badge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function CityComparisonPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-cyan-400" />
        <h1 className="text-2xl font-bold">City Comparison</h1>
      </div>

      <Tabs defaultValue="rankings">
        <TabsList>
          <TabsTrigger value="rankings"><Trophy className="w-4 h-4 mr-1" />Rankings</TabsTrigger>
          <TabsTrigger value="benchmarks"><MapPin className="w-4 h-4 mr-1" />Benchmarks</TabsTrigger>
          <TabsTrigger value="trends"><TrendingUp className="w-4 h-4 mr-1" />Trends</TabsTrigger>
        </TabsList>
        <TabsContent value="rankings" className="mt-4"><RankingsTab /></TabsContent>
        <TabsContent value="benchmarks" className="mt-4"><BenchmarksTab /></TabsContent>
        <TabsContent value="trends" className="mt-4"><TrendsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
