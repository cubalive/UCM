import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  UserPlus,
  Clock,
  MapPin,
  Navigation,
  CheckCircle,
  User,
  Truck,
  Building2,
  Accessibility,
  Lock,
  Radio,
  ArrowRight,
  Car,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  ASSIGNED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  EN_ROUTE_TO_PICKUP: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  ARRIVED_PICKUP: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  PICKED_UP: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  EN_ROUTE_TO_DROPOFF: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  IN_PROGRESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  NO_SHOW: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  EN_ROUTE_TO_PICKUP: "En Route Pickup",
  ARRIVED_PICKUP: "Arrived Pickup",
  PICKED_UP: "Picked Up",
  EN_ROUTE_TO_DROPOFF: "En Route Dropoff",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DispatchBoardPage() {
  const { token, selectedCity } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("unassigned");
  const [search, setSearch] = useState("");
  const [assignTrip, setAssignTrip] = useState<any | null>(null);

  const cityId = selectedCity?.id;

  const tripsQuery = useQuery<any[]>({
    queryKey: ["/api/dispatch/trips", activeTab, cityId, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const qs = params.toString();
      return apiFetch(`/api/dispatch/trips/${activeTab}${qs ? `?${qs}` : ""}`, token);
    },
    enabled: !!token,
    refetchInterval: 15000,
  });

  const assignDriverMutation = useMutation({
    mutationFn: ({ tripId, driverId, vehicleId }: { tripId: number; driverId: number; vehicleId?: number }) =>
      apiFetch(`/api/trips/${tripId}/assign`, token, {
        method: "PATCH",
        body: JSON.stringify({ driverId, vehicleId }),
      }),
    onSuccess: () => {
      toast({ title: "Driver assigned successfully" });
      setAssignTrip(null);
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
    },
    onError: (err: any) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  const trips = tripsQuery.data || [];

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-dispatch-board-title">
            Dispatch Operations Board
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedCity ? selectedCity.name : "All Cities"}
          </p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search trips..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-dispatch-search"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="unassigned" data-testid="tab-unassigned">
            Unassigned
            {activeTab === "unassigned" && trips.length > 0 && (
              <Badge variant="secondary" className="ml-1">{trips.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="scheduled" data-testid="tab-scheduled">
            Scheduled
          </TabsTrigger>
          <TabsTrigger value="active" data-testid="tab-active">
            Active
          </TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-completed">
            Completed
          </TabsTrigger>
        </TabsList>

        <TabsContent value="unassigned" className="mt-4">
          <TripList
            trips={trips}
            loading={tripsQuery.isLoading}
            tab="unassigned"
            onAssign={(trip) => setAssignTrip(trip)}
          />
        </TabsContent>
        <TabsContent value="scheduled" className="mt-4">
          <TripList trips={trips} loading={tripsQuery.isLoading} tab="scheduled" />
        </TabsContent>
        <TabsContent value="active" className="mt-4">
          <TripList trips={trips} loading={tripsQuery.isLoading} tab="active" />
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
          <TripList trips={trips} loading={tripsQuery.isLoading} tab="completed" />
        </TabsContent>
      </Tabs>

      <Dialog open={!!assignTrip} onOpenChange={(open) => { if (!open) setAssignTrip(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Driver to {assignTrip?.publicId}</DialogTitle>
          </DialogHeader>
          <AssignDriverPanel
            trip={assignTrip}
            token={token}
            cityId={cityId}
            onAssign={(driverId, vehicleId) => {
              if (assignTrip) assignDriverMutation.mutate({ tripId: assignTrip.id, driverId, vehicleId });
            }}
            loading={assignDriverMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TripList({
  trips,
  loading,
  tab,
  onAssign,
}: {
  trips: any[];
  loading: boolean;
  tab: string;
  onAssign?: (trip: any) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground" data-testid={`text-empty-${tab}`}>
        No {tab} trips
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`list-${tab}-trips`}>
      {trips.map((trip) => (
        <TripCard key={trip.id} trip={trip} tab={tab} onAssign={onAssign} />
      ))}
    </div>
  );
}

function TripCard({ trip, tab, onAssign }: { trip: any; tab: string; onAssign?: (trip: any) => void }) {
  const isCompleted = tab === "completed" || ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status);

  return (
    <Card data-testid={`card-trip-${trip.id}`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium" data-testid={`text-trip-id-${trip.id}`}>
                {trip.publicId}
              </span>
              <Badge className={STATUS_COLORS[trip.status] || ""}>{STATUS_LABELS[trip.status] || trip.status}</Badge>
              {trip.tripType === "recurring" && <Badge variant="outline">Recurring</Badge>}
              {trip.notes?.toLowerCase().includes("wheelchair") && (
                <Badge variant="outline" className="gap-1">
                  <Accessibility className="w-3 h-3" />
                  Wheelchair
                </Badge>
              )}
              {isCompleted && (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="w-3 h-3" />
                  Locked
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {trip.patientName && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3 flex-shrink-0" />
                  {trip.patientName}
                </span>
              )}
              {trip.clinicName && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3 flex-shrink-0" />
                  {trip.clinicName}
                </span>
              )}
              {trip.pickupTime && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  {trip.pickupTime} on {trip.scheduledDate}
                </span>
              )}
              {trip.cityName && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  {trip.cityName}
                </span>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Navigation className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{trip.pickupAddress}</span>
                <ArrowRight className="w-3 h-3 flex-shrink-0 mx-0.5" />
                <span className="truncate">{trip.dropoffAddress}</span>
              </span>
            </div>

            {(tab === "scheduled" || tab === "active") && trip.driverName && (
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-foreground font-medium">
                  <User className="w-3 h-3" />
                  {trip.driverName}
                </span>
                {trip.vehicleLabel && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Car className="w-3 h-3" />
                    {trip.vehicleLabel}
                  </span>
                )}
              </div>
            )}

            {tab === "active" && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {trip.driverLastSeenAt && (
                  <span className="flex items-center gap-1">
                    <Radio className="w-3 h-3" />
                    GPS: {formatTimeAgo(trip.driverLastSeenAt)}
                  </span>
                )}
                {trip.lastEtaMinutes != null && (
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    <Clock className="w-3 h-3" />
                    ETA: {trip.lastEtaMinutes} min
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 flex-shrink-0">
            {tab === "unassigned" && onAssign && (
              <Button
                size="sm"
                onClick={() => onAssign(trip)}
                data-testid={`button-assign-${trip.id}`}
              >
                <UserPlus className="w-3.5 h-3.5 mr-1" />
                Assign
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AssignDriverPanel({
  trip,
  token,
  cityId,
  onAssign,
  loading,
}: {
  trip: any;
  token: string | null;
  cityId?: number;
  onAssign: (driverId: number, vehicleId?: number) => void;
  loading: boolean;
}) {
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");

  const activeDriversQuery = useQuery<any[]>({
    queryKey: ["/api/dispatch/drivers/active", cityId],
    queryFn: () => apiFetch(`/api/dispatch/drivers/active${cityId ? `?cityId=${cityId}` : ""}`, token),
    enabled: !!token && !!trip,
  });

  const activeDrivers = activeDriversQuery.data || [];

  return (
    <div className="space-y-4">
      <div>
        <Label>Select Active Driver</Label>
        {activeDriversQuery.isLoading ? (
          <Skeleton className="h-10 w-full mt-1" />
        ) : activeDrivers.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-no-drivers-available">
            No active drivers available in this city.
          </p>
        ) : (
          <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
            <SelectTrigger className="w-full mt-1" data-testid="select-assign-driver">
              <SelectValue placeholder="Choose a driver" />
            </SelectTrigger>
            <SelectContent>
              {activeDrivers.map((d: any) => (
                <SelectItem key={d.id} value={d.id.toString()} data-testid={`option-driver-${d.id}`}>
                  {d.firstName} {d.lastName}
                  {d.vehicleName ? ` - ${d.vehicleName}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <DialogFooter>
        <Button
          onClick={() => {
            if (!selectedDriverId) return;
            const driver = activeDrivers.find((d: any) => d.id === parseInt(selectedDriverId));
            onAssign(parseInt(selectedDriverId), driver?.vehicleId || undefined);
          }}
          disabled={loading || !selectedDriverId}
          data-testid="button-confirm-assign"
        >
          {loading ? "Assigning..." : "Assign Driver"}
        </Button>
      </DialogFooter>
    </div>
  );
}
