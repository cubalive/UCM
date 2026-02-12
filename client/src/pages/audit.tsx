import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function AuditPage() {
  const { token, selectedCity } = useAuth();
  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const { data: logs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/audit", selectedCity?.id],
    queryFn: () => apiFetch(`/api/audit${cityParam}`, token),
    enabled: !!token,
  });

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">System activity history</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !logs?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No audit entries</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logs.map((log: any) => (
            <Card key={log.id}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Badge variant="secondary" className="flex-shrink-0">{log.action}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{log.entity}</span>
                        {log.entityId && <span className="text-muted-foreground"> #{log.entityId}</span>}
                      </p>
                      {log.details && <p className="text-xs text-muted-foreground truncate">{log.details}</p>}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
