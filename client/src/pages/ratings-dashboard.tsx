import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Star, TrendingUp, Users, ThumbsUp, Search } from "lucide-react";

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
      ))}
      <span className="ml-1 text-sm font-medium">{rating.toFixed(1)}</span>
    </div>
  );
}

function getDefaultDates() {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
  return { from, to };
}

function RatingsListTab() {
  const { token } = useAuth();
  const defaults = getDefaultDates();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [minRating, setMinRating] = useState<string>("all");

  const ratingsQuery = useQuery<{ ratings: any[]; count: number }>({
    queryKey: ["/api/ratings", from, to],
    queryFn: () => apiFetch(`/api/ratings?from=${from}&to=${to}&limit=100`, token),
  });

  const ratings = ratingsQuery.data?.ratings || [];
  const filtered = minRating === "all"
    ? ratings
    : ratings.filter((r: any) => r.overallRating <= parseInt(minRating));

  if (ratingsQuery.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        <Select value={minRating} onValueChange={setMinRating}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Filter" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Ratings</SelectItem>
            <SelectItem value="3">3 Stars & Below</SelectItem>
            <SelectItem value="2">2 Stars & Below</SelectItem>
            <SelectItem value="1">1 Star Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Overall</TableHead>
              <TableHead>Punctuality</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Safety</TableHead>
              <TableHead>Comment</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No ratings found</TableCell></TableRow>
            ) : (
              filtered.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.createdAt).toLocaleDateString("en-US")}</TableCell>
                  <TableCell>{r.anonymous ? <Badge variant="secondary">Anonymous</Badge> : `${r.patientFirstName || ""} ${r.patientLastName || ""}`}</TableCell>
                  <TableCell>{r.driverFirstName} {r.driverLastName}</TableCell>
                  <TableCell><StarDisplay rating={r.overallRating} /></TableCell>
                  <TableCell><StarDisplay rating={r.punctualityRating || 0} /></TableCell>
                  <TableCell><StarDisplay rating={r.vehicleRating || 0} /></TableCell>
                  <TableCell><StarDisplay rating={r.safetyRating || 0} /></TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs">{r.comment || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.source || "link"}</Badge></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CompanySummaryTab() {
  const { token } = useAuth();
  const summaryQuery = useQuery<any>({
    queryKey: ["/api/ratings/company/summary"],
    queryFn: () => apiFetch("/api/ratings/company/summary", token),
  });

  if (summaryQuery.isLoading) return <Skeleton className="h-40 w-full" />;
  const s = summaryQuery.data;
  if (!s) return <p className="text-muted-foreground">No data available</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Average Rating</CardTitle></CardHeader>
        <CardContent><StarDisplay rating={s.averageOverall || 0} /><p className="text-xs text-muted-foreground mt-1">{s.totalRatings || 0} total ratings</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Punctuality</CardTitle></CardHeader>
        <CardContent><StarDisplay rating={s.averagePunctuality || 0} /></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Driver Rating</CardTitle></CardHeader>
        <CardContent><StarDisplay rating={s.averageDriver || 0} /></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Vehicle & Safety</CardTitle></CardHeader>
        <CardContent>
          <StarDisplay rating={s.averageVehicle || 0} />
          <StarDisplay rating={s.averageSafety || 0} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function RatingsDashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Star className="h-6 w-6 text-yellow-400" />
        <h1 className="text-2xl font-bold">Patient Ratings</h1>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list"><Search className="w-4 h-4 mr-1" />All Ratings</TabsTrigger>
          <TabsTrigger value="summary"><TrendingUp className="w-4 h-4 mr-1" />Company Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4"><RatingsListTab /></TabsContent>
        <TabsContent value="summary" className="mt-4"><CompanySummaryTab /></TabsContent>
      </Tabs>
    </div>
  );
}
