import { useState, useMemo, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, User, Search, X, Filter, Calendar } from "lucide-react";
import { apiFetch } from "@/lib/api";

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-500/15 text-green-600 dark:text-green-400",
  UPDATE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400",
  ARCHIVE: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  RESTORE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  LOGIN: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  PATCH: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  BULK_ARCHIVE: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  UPDATE_BONUS_RULES: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  CANCEL: "bg-red-500/15 text-red-600 dark:text-red-400",
  STATUS_CHANGE: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  ASSIGN: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
};

const ALL_ACTIONS = [
  "LOGIN", "CREATE", "UPDATE", "DELETE", "ARCHIVE", "RESTORE", "PATCH",
  "BULK_ARCHIVE", "UPDATE_BONUS_RULES", "CANCEL", "STATUS_CHANGE", "ASSIGN",
];

const ALL_ENTITIES = [
  "user", "trip", "patient", "driver", "vehicle", "clinic", "city",
  "invoice", "company", "driver_bonus_rules", "fee_rule", "pricing",
];

const ALL_ROLES = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "ADMIN", label: "Admin" },
  { value: "COMPANY_ADMIN", label: "Company Admin" },
  { value: "DISPATCH", label: "Dispatch" },
  { value: "DRIVER", label: "Driver" },
  { value: "VIEWER", label: "Viewer" },
  { value: "CLINIC_ADMIN", label: "Clinic Admin" },
  { value: "CLINIC_USER", label: "Clinic User" },
  { value: "CLINIC_VIEWER", label: "Clinic Viewer" },
];

export default function AuditPage() {
  const { token, selectedCity } = useAuth();

  const [actionFilter, setActionFilter] = useState<string>("");
  const [entityFilter, setEntityFilter] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(searchText.trim()), 400);
    return () => clearTimeout(debounceRef.current);
  }, [searchText]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedCity?.id) params.set("cityId", String(selectedCity.id));
    if (actionFilter) params.set("action", actionFilter);
    if (entityFilter) params.set("entity", entityFilter);
    if (roleFilter) params.set("actorRole", roleFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  }, [selectedCity?.id, actionFilter, entityFilter, roleFilter, debouncedSearch, dateFrom, dateTo]);

  const { data: logs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/audit", queryParams],
    queryFn: () => apiFetch(`/api/audit${queryParams ? `?${queryParams}` : ""}`, token),
    enabled: !!token,
  });

  const hasActiveFilters = actionFilter || entityFilter || roleFilter || searchText.trim() || dateFrom || dateTo;

  function clearFilters() {
    setActionFilter("");
    setEntityFilter("");
    setRoleFilter("");
    setSearchText("");
    setDateFrom("");
    setDateTo("");
  }


  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-audit-title">Audit Log</h1>
          <p className="text-sm text-muted-foreground mt-1">System activity history</p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
              <X className="w-4 h-4 mr-1" />
              Clear filters
            </Button>
          )}
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-filters"
          >
            <Filter className="w-4 h-4 mr-1" />
            Filters
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">{
                [actionFilter, entityFilter, roleFilter, searchText.trim(), dateFrom, dateTo].filter(Boolean).length
              }</Badge>
            )}
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card data-testid="card-filters">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search details, entity, user..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pl-8"
                  data-testid="input-search-audit"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              <Select value={actionFilter} onValueChange={(v) => setActionFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger data-testid="select-action-filter">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Actions</SelectItem>
                  {ALL_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={entityFilter} onValueChange={(v) => setEntityFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger data-testid="select-entity-filter">
                  <SelectValue placeholder="Entity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Entities</SelectItem>
                  {ALL_ENTITIES.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger data-testid="select-role-filter">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Roles</SelectItem>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="pl-8"
                  placeholder="From"
                  data-testid="input-date-from"
                />
              </div>

              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="pl-8"
                  placeholder="To"
                  data-testid="input-date-to"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !logs?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground" data-testid="text-no-audit">
              {hasActiveFilters ? "No audit entries match the current filters" : "No audit entries"}
            </p>
            {hasActiveFilters && (
              <Button variant="link" size="sm" onClick={clearFilters} className="mt-2">
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="text-log-count">
            Showing {logs.length} entries{hasActiveFilters ? " (filtered)" : ""}
          </p>
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
                            <Badge variant="outline" className="text-[10px] py-0 px-1 ml-1">{log.actorRole.replace(/_/g, " ")}</Badge>
                          )}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
