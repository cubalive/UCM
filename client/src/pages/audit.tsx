import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, User } from "lucide-react";
import { apiFetch } from "@/lib/api";

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-500/15 text-green-600 dark:text-green-400",
  UPDATE: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400",
  ARCHIVE: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  RESTORE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  LOGIN: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  PATCH: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
};

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
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-audit-title">Audit Log</h1>
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
            <p className="text-muted-foreground" data-testid="text-no-audit">No audit entries</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logs.map((log: any) => (
            <Card key={log.id} data-testid={`card-audit-${log.id}`}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Badge
                      variant="secondary"
                      className={`flex-shrink-0 border-0 ${ACTION_COLORS[log.action] || ""}`}
                    >
                      {log.action}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{log.entity}</span>
                        {log.entityId && <span className="text-muted-foreground"> #{log.entityId}</span>}
                      </p>
                      {log.details && <p className="text-xs text-muted-foreground truncate max-w-md">{log.details}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {log.actorName && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {log.actorName}
                        {log.actorRole && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1 ml-1">{log.actorRole}</Badge>
                        )}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
