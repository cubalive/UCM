import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Users, Layers, Zap, DollarSign, Loader2, ChevronDown, ChevronRight } from "lucide-react";

export default function TripGroupsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);

  const groupsQuery = useQuery<any>({
    queryKey: ["/api/trip-groups"],
    queryFn: () => apiFetch("/api/trip-groups", token),
  });

  const autoGroupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/trip-groups/auto-detect");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trip-groups"] });
      toast({ title: "Auto-grouping complete", description: `${data.groupsCreated || 0} groups detected` });
    },
    onError: (err: any) => toast({ title: "Auto-group failed", description: err.message, variant: "destructive" }),
  });

  const optimizeMutation = useMutation({
    mutationFn: async (groupId: number) => {
      const res = await apiRequest("POST", `/api/trip-groups/${groupId}/optimize`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trip-groups"] });
      toast({ title: "Pickup order optimized" });
    },
    onError: (err: any) => toast({ title: "Optimize failed", description: err.message, variant: "destructive" }),
  });

  const savingsQuery = useQuery<any>({
    queryKey: ["/api/trip-groups/savings"],
    queryFn: () => apiFetch("/api/trip-groups/savings", token),
  });

  const groups = groupsQuery.data?.groups || [];
  const savings = savingsQuery.data;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers className="h-6 w-6 text-purple-400" />
          <h1 className="text-2xl font-bold">Trip Groups</h1>
        </div>
        <Button onClick={() => autoGroupMutation.mutate()} disabled={autoGroupMutation.isPending}>
          {autoGroupMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
          Auto-Detect Groups
        </Button>
      </div>

      {savings && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Active Groups</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{savings.activeGroups || 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Trips Grouped</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{savings.tripsGrouped || 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Est. Miles Saved</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-emerald-400">{(savings.milesSaved || 0).toFixed(1)} mi</p></CardContent>
          </Card>
        </div>
      )}

      {groupsQuery.isLoading ? <Skeleton className="h-64 w-full" /> : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No trip groups. Use Auto-Detect to find groupable trips.</TableCell></TableRow>
              ) : (
                groups.map((g: any) => (
                  <TableRow key={g.id} className="cursor-pointer" onClick={() => setExpandedGroup(expandedGroup === g.id ? null : g.id)}>
                    <TableCell>{expandedGroup === g.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</TableCell>
                    <TableCell className="font-medium">{g.name || `Group #${g.id}`}</TableCell>
                    <TableCell><Badge variant="outline">{g.groupType || "proximity"}</Badge></TableCell>
                    <TableCell>{g.memberCount || 0} trips</TableCell>
                    <TableCell><Badge variant={g.status === "active" ? "default" : "secondary"}>{g.status || "active"}</Badge></TableCell>
                    <TableCell className="text-xs">{g.createdAt ? new Date(g.createdAt).toLocaleDateString("en-US") : "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); optimizeMutation.mutate(g.id); }}>
                        Optimize Order
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
