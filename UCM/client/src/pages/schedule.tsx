import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DriverRef } from "@/components/entity-ref";
import {
  Calendar,
  Clock,
  UserCheck,
  Users,
  ArrowLeftRight,
  RefreshCw,
  Save,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Check,
  X,
  Loader2,
} from "lucide-react";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_LABELS: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

interface DriverInfo {
  id: number;
  firstName: string;
  lastName: string;
  publicId: string;
  phone: string;
  cityId: number;
  status: string;
  wheelchairCapable?: boolean;
}

interface WeeklySchedule {
  id: number;
  driverId: number;
  cityId: number;
  monEnabled: boolean;
  monStart: string | null;
  monEnd: string | null;
  tueEnabled: boolean;
  tueStart: string | null;
  tueEnd: string | null;
  wedEnabled: boolean;
  wedStart: string | null;
  wedEnd: string | null;
  thuEnabled: boolean;
  thuStart: string | null;
  thuEnd: string | null;
  friEnabled: boolean;
  friStart: string | null;
  friEnd: string | null;
  satEnabled: boolean;
  satStart: string | null;
  satEnd: string | null;
}

interface ReplacementRecord {
  id: number;
  replacementDate: string;
  cityId: number;
  outDriverId: number;
  substituteDriverId: number;
  status: string;
}

interface SubstituteEntry {
  id: number;
  poolDate: string;
  cityId: number;
  driverId: number;
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getNextSunday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function WeeklyScheduleTab({ cityId, token }: { cityId: number; token: string }) {
  const { toast } = useToast();
  const [localSchedules, setLocalSchedules] = useState<Record<number, Record<string, any>>>({});
  const [dirty, setDirty] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/schedules/weekly", cityId],
    queryFn: () => apiFetch(`/api/schedules/weekly?cityId=${cityId}`, token),
    enabled: !!cityId,
  });

  const drivers: DriverInfo[] = data?.drivers || [];
  const schedules: WeeklySchedule[] = data?.schedules || [];

  useEffect(() => {
    if (!schedules.length && !drivers.length) return;
    const map: Record<number, Record<string, any>> = {};
    for (const d of drivers) {
      const existing = schedules.find((s) => s.driverId === d.id);
      map[d.id] = {};
      for (const day of DAYS) {
        map[d.id][`${day}Enabled`] = existing ? (existing as any)[`${day}Enabled`] : false;
        map[d.id][`${day}Start`] = existing ? (existing as any)[`${day}Start`] || "06:00" : "06:00";
        map[d.id][`${day}End`] = existing ? (existing as any)[`${day}End`] || "18:00" : "18:00";
      }
    }
    setLocalSchedules(map);
    setDirty(false);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const schedulePayloads = Object.entries(localSchedules).map(([driverId, days]) => ({
        driverId: parseInt(driverId),
        ...days,
      }));
      return apiFetch("/api/schedules/weekly/bulk", token, {
        method: "POST",
        body: JSON.stringify({ cityId, schedules: schedulePayloads }),
      });
    },
    onSuccess: () => {
      toast({ title: "Schedules saved", description: "Weekly schedules updated successfully." });
      setDirty(false);
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleDay = (driverId: number, day: string) => {
    setLocalSchedules((prev) => ({
      ...prev,
      [driverId]: {
        ...prev[driverId],
        [`${day}Enabled`]: !prev[driverId]?.[`${day}Enabled`],
      },
    }));
    setDirty(true);
  };

  const setTime = (driverId: number, day: string, field: "Start" | "End", value: string) => {
    setLocalSchedules((prev) => ({
      ...prev,
      [driverId]: {
        ...prev[driverId],
        [`${day}${field}`]: value,
      },
    }));
    setDirty(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  if (!drivers.length) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid="text-no-drivers">
        No active drivers in this city.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Configure working days and hours for each driver. Mon-Sat schedule.
        </p>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          data-testid="button-save-weekly"
        >
          <Save className="w-4 h-4 mr-2" />
          {saveMutation.isPending ? "Saving..." : "Save All"}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-weekly-schedules">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-2 font-medium min-w-[140px]">Driver</th>
              {DAYS.map((day) => (
                <th key={day} className="text-center py-2 px-1 font-medium min-w-[100px]">
                  {DAY_LABELS[day]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drivers.map((driver) => {
              const sched = localSchedules[driver.id] || {};
              return (
                <tr key={driver.id} className="border-b" data-testid={`row-schedule-${driver.id}`}>
                  <td className="py-2 px-2">
                    <DriverRef id={driver.id} label={`${driver.firstName} ${driver.lastName}`} size="md" />
                    <div className="text-xs text-muted-foreground">{driver.publicId}</div>
                  </td>
                  {DAYS.map((day) => {
                    const enabled = sched[`${day}Enabled`];
                    return (
                      <td key={day} className="py-2 px-1 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Switch
                            checked={!!enabled}
                            onCheckedChange={() => toggleDay(driver.id, day)}
                            data-testid={`switch-${driver.id}-${day}`}
                          />
                          {enabled && (
                            <div className="flex gap-1">
                              <Input
                                type="time"
                                value={sched[`${day}Start`] || "06:00"}
                                onChange={(e) => setTime(driver.id, day, "Start", e.target.value)}
                                className="w-[80px] text-xs h-7 px-1"
                                data-testid={`input-${driver.id}-${day}-start`}
                              />
                              <Input
                                type="time"
                                value={sched[`${day}End`] || "18:00"}
                                onChange={(e) => setTime(driver.id, day, "End", e.target.value)}
                                className="w-[80px] text-xs h-7 px-1"
                                data-testid={`input-${driver.id}-${day}-end`}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface RosterDriverEntry {
  id: number;
  rosterId: number;
  driverId: number;
  driver: DriverInfo | null;
}

function SundayRosterTab({ cityId, token }: { cityId: number; token: string }) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(getNextSunday());
  const [addDriverId, setAddDriverId] = useState<string>("");

  const { data: rosterData, isLoading, refetch } = useQuery({
    queryKey: ["/api/schedules/sunday-roster", cityId, selectedDate],
    queryFn: () => apiFetch(`/api/schedules/sunday-roster?cityId=${cityId}&date=${selectedDate}`, token),
    enabled: !!cityId && !!selectedDate,
  });

  const { data: allDriversData } = useQuery({
    queryKey: ["/api/schedules/weekly", cityId],
    queryFn: () => apiFetch(`/api/schedules/weekly?cityId=${cityId}`, token),
    enabled: !!cityId,
  });

  const allDrivers: DriverInfo[] = allDriversData?.drivers || [];
  const rosterEntries: RosterDriverEntry[] = rosterData?.rosterDriverEntries || [];
  const rosterDriverIds = new Set(rosterEntries.map((e: RosterDriverEntry) => e.driverId));
  const availableDrivers = allDrivers.filter((d) => !rosterDriverIds.has(d.id));
  const rosterEnabled = rosterData?.roster?.enabled ?? false;

  const addMutation = useMutation({
    mutationFn: (driverId: number) =>
      apiFetch("/api/schedules/sunday-roster/drivers", token, {
        method: "POST",
        body: JSON.stringify({ cityId, date: selectedDate, driverId }),
      }),
    onSuccess: () => {
      toast({ title: "Driver added to Sunday roster" });
      setAddDriverId("");
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (entryId: number) =>
      apiFetch(`/api/schedules/sunday-roster/drivers/${entryId}`, token, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Driver removed from Sunday roster" });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleRosterMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch("/api/schedules/sunday-roster", token, {
        method: "POST",
        body: JSON.stringify({ cityId, date: selectedDate, enabled }),
      }),
    onSuccess: () => {
      toast({ title: rosterEnabled ? "Sunday roster disabled" : "Sunday roster enabled" });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const navigateSunday = (direction: number) => {
    const d = new Date(selectedDate + "T12:00:00Z");
    d.setDate(d.getDate() + direction * 7);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="icon" variant="outline" onClick={() => navigateSunday(-1)} data-testid="button-prev-sunday">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="text-sm font-medium min-w-[200px] text-center" data-testid="text-sunday-date">
          {formatDateLabel(selectedDate)}
        </div>
        <Button size="icon" variant="outline" onClick={() => navigateSunday(1)} data-testid="button-next-sunday">
          <ChevronRight className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2 ml-4">
          <Switch
            checked={rosterEnabled}
            onCheckedChange={(checked) => toggleRosterMutation.mutate(checked)}
            data-testid="switch-sunday-enabled"
          />
          <Label className="text-sm">{rosterEnabled ? "Sunday Enabled" : "Sunday Disabled"}</Label>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Roster Drivers</CardTitle>
          <Badge variant={rosterEntries.length > 0 ? "default" : "secondary"}>
            {rosterEntries.length} driver{rosterEntries.length !== 1 ? "s" : ""}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {rosterEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-sunday-drivers">
              No drivers assigned to this Sunday yet.
            </p>
          ) : (
            <div className="space-y-2">
              {rosterEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0"
                  data-testid={`row-sunday-driver-${entry.driverId}`}
                >
                  <div>
                    <DriverRef id={entry.driverId} label={entry.driver ? `${entry.driver.firstName} ${entry.driver.lastName}` : `Driver #${entry.driverId}`} size="md" />
                    {entry.driver && (
                      <span className="text-xs text-muted-foreground ml-2">{entry.driver.publicId}</span>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeMutation.mutate(entry.id)}
                    data-testid={`button-remove-sunday-${entry.driverId}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t">
            <Select value={addDriverId} onValueChange={setAddDriverId}>
              <SelectTrigger className="flex-1" data-testid="select-add-sunday-driver">
                <SelectValue placeholder="Select driver to add..." />
              </SelectTrigger>
              <SelectContent>
                {availableDrivers.map((d) => (
                  <SelectItem key={d.id} value={d.id.toString()}>
                    {d.firstName} {d.lastName} ({d.publicId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => addDriverId && addMutation.mutate(parseInt(addDriverId))}
              disabled={!addDriverId || addMutation.isPending}
              data-testid="button-add-sunday-driver"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SubstitutePoolTab({ cityId, token }: { cityId: number; token: string }) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [addDriverId, setAddDriverId] = useState<string>("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/schedules/substitutes", cityId, selectedDate],
    queryFn: () => apiFetch(`/api/schedules/substitutes?cityId=${cityId}&date=${selectedDate}`, token),
    enabled: !!cityId && !!selectedDate,
  });

  const { data: allDriversData } = useQuery({
    queryKey: ["/api/schedules/weekly", cityId],
    queryFn: () => apiFetch(`/api/schedules/weekly?cityId=${cityId}`, token),
    enabled: !!cityId,
  });

  const allDrivers: DriverInfo[] = allDriversData?.drivers || [];
  const substitutes: SubstituteEntry[] = data?.substitutes || [];
  const subDrivers: DriverInfo[] = data?.drivers || [];
  const subDriverIds = new Set(substitutes.map((s: SubstituteEntry) => s.driverId));
  const availableDrivers = allDrivers.filter((d) => !subDriverIds.has(d.id));

  const addMutation = useMutation({
    mutationFn: (driverId: number) =>
      apiFetch("/api/schedules/substitutes", token, {
        method: "POST",
        body: JSON.stringify({ cityId, date: selectedDate, driverId }),
      }),
    onSuccess: () => {
      toast({ title: "Driver added to substitute pool" });
      setAddDriverId("");
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/schedules/substitutes/${id}`, token, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Driver removed from substitute pool" });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  const getDriverName = (driverId: number) => {
    const d = subDrivers.find((dr: DriverInfo) => dr.id === driverId) || allDrivers.find((dr) => dr.id === driverId);
    return d ? `${d.firstName} ${d.lastName}` : `Driver #${driverId}`;
  };

  const getDriverPublicId = (driverId: number) => {
    const d = subDrivers.find((dr: DriverInfo) => dr.id === driverId) || allDrivers.find((dr) => dr.id === driverId);
    return d?.publicId || "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Label className="text-sm font-medium">Date:</Label>
        <Input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-[180px]"
          data-testid="input-substitute-date"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Substitute Drivers for {formatDateLabel(selectedDate)}</CardTitle>
          <Badge variant={substitutes.length > 0 ? "default" : "secondary"}>
            {substitutes.length}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {substitutes.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-substitutes">
              No substitute drivers for this date.
            </p>
          ) : (
            <div className="space-y-2">
              {substitutes.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0"
                  data-testid={`row-substitute-${sub.id}`}
                >
                  <div>
                    <span className="font-medium">{getDriverName(sub.driverId)}</span>
                    <span className="text-xs text-muted-foreground ml-2">{getDriverPublicId(sub.driverId)}</span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeMutation.mutate(sub.id)}
                    data-testid={`button-remove-substitute-${sub.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t">
            <Select value={addDriverId} onValueChange={setAddDriverId}>
              <SelectTrigger className="flex-1" data-testid="select-add-substitute">
                <SelectValue placeholder="Select driver to add..." />
              </SelectTrigger>
              <SelectContent>
                {availableDrivers.map((d) => (
                  <SelectItem key={d.id} value={d.id.toString()}>
                    {d.firstName} {d.lastName} ({d.publicId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => addDriverId && addMutation.mutate(parseInt(addDriverId))}
              disabled={!addDriverId || addMutation.isPending}
              data-testid="button-add-substitute"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReplaceDriverTab({ cityId, token }: { cityId: number; token: string }) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [outDriverId, setOutDriverId] = useState<string>("");
  const [subDriverId, setSubDriverId] = useState<string>("");
  const [showReassignDialog, setShowReassignDialog] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<{ outId: number; subId: number } | null>(null);

  const { data: replacementData, isLoading, refetch } = useQuery({
    queryKey: ["/api/schedules/replacements", cityId, selectedDate],
    queryFn: () => apiFetch(`/api/schedules/replacements?cityId=${cityId}&date=${selectedDate}`, token),
    enabled: !!cityId && !!selectedDate,
  });

  const { data: allDriversData } = useQuery({
    queryKey: ["/api/schedules/weekly", cityId],
    queryFn: () => apiFetch(`/api/schedules/weekly?cityId=${cityId}`, token),
    enabled: !!cityId,
  });

  const allDrivers: DriverInfo[] = allDriversData?.drivers || [];
  const replacements: ReplacementRecord[] = replacementData || [];

  const getDriverName = (driverId: number) => {
    const d = allDrivers.find((dr) => dr.id === driverId);
    return d ? `${d.firstName} ${d.lastName}` : `Driver #${driverId}`;
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/schedules/replacements", token, {
        method: "POST",
        body: JSON.stringify({
          cityId,
          date: selectedDate,
          outDriverId: parseInt(outDriverId),
          substituteDriverId: parseInt(subDriverId),
        }),
      }),
    onSuccess: () => {
      toast({ title: "Replacement created" });
      setOutDriverId("");
      setSubDriverId("");
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/schedules/replacements/${id}`, token, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Replacement removed" });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reassignMutation = useMutation({
    mutationFn: (params: { outDriverId: number; substituteDriverId: number }) =>
      apiFetch("/api/schedules/reassign", token, {
        method: "POST",
        body: JSON.stringify({
          cityId,
          date: selectedDate,
          outDriverId: params.outDriverId,
          substituteDriverId: params.substituteDriverId,
        }),
      }),
    onSuccess: (data: any) => {
      toast({
        title: "Trips reassigned",
        description: `${data.reassigned} trip(s) moved to substitute driver.`,
      });
      setShowReassignDialog(false);
      setReassignTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Label className="text-sm font-medium">Date:</Label>
        <Input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-[180px]"
          data-testid="input-replacement-date"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Create Replacement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Driver Out</Label>
              <Select value={outDriverId} onValueChange={setOutDriverId}>
                <SelectTrigger data-testid="select-out-driver">
                  <SelectValue placeholder="Select driver going out..." />
                </SelectTrigger>
                <SelectContent>
                  {allDrivers.map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      {d.firstName} {d.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ArrowLeftRight className="w-5 h-5 text-muted-foreground flex-shrink-0 mb-2" />
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Substitute Driver</Label>
              <Select value={subDriverId} onValueChange={setSubDriverId}>
                <SelectTrigger data-testid="select-substitute-driver">
                  <SelectValue placeholder="Select substitute..." />
                </SelectTrigger>
                <SelectContent>
                  {allDrivers.filter((d) => d.id.toString() !== outDriverId).map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      {d.firstName} {d.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!outDriverId || !subDriverId || createMutation.isPending}
              data-testid="button-create-replacement"
            >
              <Plus className="w-4 h-4 mr-1" />
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Active Replacements</CardTitle>
          <Badge variant={replacements.length > 0 ? "default" : "secondary"}>
            {replacements.length}
          </Badge>
        </CardHeader>
        <CardContent>
          {replacements.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-replacements">
              No replacements for this date.
            </p>
          ) : (
            <div className="space-y-3">
              {replacements.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 py-2 border-b last:border-0"
                  data-testid={`row-replacement-${r.id}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{getDriverName(r.outDriverId)}</Badge>
                    <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
                    <Badge variant="default">{getDriverName(r.substituteDriverId)}</Badge>
                    <Badge variant={r.status === "active" ? "default" : "secondary"} className="text-xs">
                      {r.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReassignTarget({ outId: r.outDriverId, subId: r.substituteDriverId });
                        setShowReassignDialog(true);
                      }}
                      data-testid={`button-reassign-${r.id}`}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Reassign Trips
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeMutation.mutate(r.id)}
                      data-testid={`button-remove-replacement-${r.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showReassignDialog} onOpenChange={setShowReassignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Trip Reassignment</DialogTitle>
            <DialogDescription>
              This will move all SCHEDULED and ASSIGNED trips from{" "}
              <strong>{reassignTarget ? getDriverName(reassignTarget.outId) : ""}</strong> to{" "}
              <strong>{reassignTarget ? getDriverName(reassignTarget.subId) : ""}</strong> for{" "}
              {formatDateLabel(selectedDate)}.
              Trips that are already in-progress will remain with the original driver.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReassignDialog(false)} data-testid="button-cancel-reassign">
              Cancel
            </Button>
            <Button
              onClick={() =>
                reassignTarget &&
                reassignMutation.mutate({
                  outDriverId: reassignTarget.outId,
                  substituteDriverId: reassignTarget.subId,
                })
              }
              disabled={reassignMutation.isPending}
              data-testid="button-confirm-reassign"
            >
              {reassignMutation.isPending ? "Reassigning..." : "Confirm Reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChangeRequestsTab({ cityId, token }: { cityId: number; token: string }) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [decisionAction, setDecisionAction] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [decisionNote, setDecisionNote] = useState("");

  const { data, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/dispatch/schedule-change", cityId, statusFilter],
    queryFn: () => apiFetch(`/api/dispatch/schedule-change?cityId=${cityId}&status=${statusFilter}`, token),
    enabled: !!cityId,
  });

  const decideMutation = useMutation({
    mutationFn: (payload: { id: number; status: "APPROVED" | "REJECTED"; decisionNote?: string }) =>
      apiFetch(`/api/dispatch/schedule-change/${payload.id}/decide`, token, {
        method: "POST",
        body: JSON.stringify({ status: payload.status, decisionNote: payload.decisionNote }),
      }),
    onSuccess: () => {
      toast({ title: `Request ${decisionAction.toLowerCase()}` });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/schedule-change"] });
      setDecidingId(null);
      setDecisionNote("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const requests = data || [];
  const filteredRequests = typeFilter === "all"
    ? requests
    : requests.filter((r: any) => r.requestType === typeFilter);

  const statusBadgeClass: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    APPROVED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    REJECTED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    CANCELLED: "bg-muted text-muted-foreground",
  };

  const typeLabels: Record<string, string> = {
    DAY_CHANGE: "Day Change",
    TIME_CHANGE: "Time Change",
    UNAVAILABLE: "Unavailable",
    SWAP_REQUEST: "Swap Request",
  };

  function openDecisionDialog(id: number, action: "APPROVED" | "REJECTED") {
    setDecidingId(id);
    setDecisionAction(action);
    setDecisionNote("");
  }

  function confirmDecision() {
    if (!decidingId) return;
    if (decisionAction === "REJECTED" && !decisionNote.trim()) {
      toast({ title: "Required", description: "A note is required when rejecting a request", variant: "destructive" });
      return;
    }
    decideMutation.mutate({ id: decidingId, status: decisionAction, decisionNote: decisionNote.trim() || undefined });
  }

  return (
    <div className="space-y-4" data-testid="div-change-requests-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-cr-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]" data-testid="select-cr-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="DAY_CHANGE">Day Change</SelectItem>
            <SelectItem value="TIME_CHANGE">Time Change</SelectItem>
            <SelectItem value="UNAVAILABLE">Unavailable</SelectItem>
            <SelectItem value="SWAP_REQUEST">Swap Request</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-cr-refresh">
          <RefreshCw className="w-4 h-4" />
        </Button>
        <Badge variant="secondary" data-testid="badge-cr-count">{filteredRequests.length} request{filteredRequests.length !== 1 ? "s" : ""}</Badge>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground" data-testid="text-no-change-requests">No {statusFilter !== "all" ? statusFilter.toLowerCase() : ""} change requests found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredRequests.map((req: any) => (
            <Card key={req.id} data-testid={`card-cr-${req.id}`}>
              <CardContent className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium" data-testid={`text-cr-driver-${req.id}`}>
                        {req.driverName || `Driver #${req.driverId}`}
                      </span>
                      <Badge variant="outline" className="text-xs" data-testid={`badge-cr-type-${req.id}`}>
                        {typeLabels[req.requestType] || req.requestType}
                      </Badge>
                      <Badge className={statusBadgeClass[req.status] || ""} data-testid={`badge-cr-status-${req.id}`}>
                        {req.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p data-testid={`text-cr-dates-${req.id}`}>
                        {req.currentDate && <span>Current: {req.currentDate}</span>}
                        {req.requestedDate && <span> {req.currentDate ? "→" : "Requested:"} {req.requestedDate}</span>}
                      </p>
                      {(req.requestedShiftStart || req.requestedShiftEnd) && (
                        <p>Shift: {req.requestedShiftStart || "—"} - {req.requestedShiftEnd || "—"}</p>
                      )}
                      <p data-testid={`text-cr-reason-${req.id}`}>Reason: {req.reason}</p>
                      <p className="text-xs text-muted-foreground/60">Submitted {new Date(req.createdAt).toLocaleDateString()}</p>
                    </div>
                    {req.decisionNote && (
                      <div className="text-xs bg-muted/50 rounded-md px-2 py-1" data-testid={`text-cr-decision-${req.id}`}>
                        <span className="font-medium">Decision note:</span> {req.decisionNote}
                      </div>
                    )}
                  </div>
                  {req.status === "PENDING" && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" onClick={() => openDecisionDialog(req.id, "APPROVED")} data-testid={`button-approve-cr-${req.id}`}>
                        <Check className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openDecisionDialog(req.id, "REJECTED")} data-testid={`button-reject-cr-${req.id}`}>
                        <X className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={decidingId !== null} onOpenChange={(open) => { if (!open) setDecidingId(null); }}>
        <DialogContent data-testid="dialog-cr-decision">
          <DialogHeader>
            <DialogTitle>{decisionAction === "APPROVED" ? "Approve" : "Reject"} Change Request</DialogTitle>
            <DialogDescription>
              {decisionAction === "REJECTED"
                ? "A note is required when rejecting a request."
                : "Add an optional note for the driver."
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="decision-note">Decision Note {decisionAction === "REJECTED" && "*"}</Label>
              <Textarea
                id="decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder={decisionAction === "REJECTED" ? "Explain why this request is being rejected..." : "Optional note..."}
                rows={3}
                data-testid="input-decision-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecidingId(null)} data-testid="button-cancel-decision">Cancel</Button>
            <Button
              onClick={confirmDecision}
              disabled={decideMutation.isPending || (decisionAction === "REJECTED" && !decisionNote.trim())}
              variant={decisionAction === "APPROVED" ? "default" : "destructive"}
              data-testid="button-confirm-decision"
            >
              {decideMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Confirm {decisionAction === "APPROVED" ? "Approval" : "Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SchedulePage() {
  const { token, selectedCity } = useAuth();
  const cityId = selectedCity?.id;

  if (!cityId) {
    return (
      <div className="p-6 text-center text-muted-foreground" data-testid="text-no-city">
        Please select a working city to manage schedules.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="page-schedule">
      <div className="flex items-center gap-2">
        <Calendar className="w-5 h-5" />
        <h1 className="text-xl font-semibold">Driver Schedule</h1>
      </div>

      <Tabs defaultValue="weekly" className="w-full">
        <TabsList className="w-full justify-start flex-wrap" data-testid="tabs-schedule">
          <TabsTrigger value="weekly" data-testid="tab-weekly">
            <Clock className="w-4 h-4 mr-1" />
            Weekly Schedule
          </TabsTrigger>
          <TabsTrigger value="sunday" data-testid="tab-sunday">
            <Calendar className="w-4 h-4 mr-1" />
            Sunday Roster
          </TabsTrigger>
          <TabsTrigger value="substitutes" data-testid="tab-substitutes">
            <Users className="w-4 h-4 mr-1" />
            Substitute Pool
          </TabsTrigger>
          <TabsTrigger value="replace" data-testid="tab-replace">
            <ArrowLeftRight className="w-4 h-4 mr-1" />
            Replace Driver
          </TabsTrigger>
          <TabsTrigger value="change-requests" data-testid="tab-change-requests">
            <FileText className="w-4 h-4 mr-1" />
            Change Requests
          </TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="mt-4">
          <WeeklyScheduleTab cityId={cityId} token={token!} />
        </TabsContent>

        <TabsContent value="sunday" className="mt-4">
          <SundayRosterTab cityId={cityId} token={token!} />
        </TabsContent>

        <TabsContent value="substitutes" className="mt-4">
          <SubstitutePoolTab cityId={cityId} token={token!} />
        </TabsContent>

        <TabsContent value="replace" className="mt-4">
          <ReplaceDriverTab cityId={cityId} token={token!} />
        </TabsContent>

        <TabsContent value="change-requests" className="mt-4">
          <ChangeRequestsTab cityId={cityId} token={token!} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
