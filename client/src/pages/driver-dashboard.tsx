import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import {
  Car,
  MapPin,
  Clock,
  CheckCircle,
  PlayCircle,
  Navigation,
  User,
  CalendarDays,
  History,
  AlertTriangle,
} from "lucide-react";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

type TabType = "today" | "history";

const STATUS_FLOW: Record<string, { next: string; label: string; icon: any }> = {
  SCHEDULED: { next: "ASSIGNED", label: "Accept Trip", icon: CheckCircle },
  ASSIGNED: { next: "IN_PROGRESS", label: "Start Trip", icon: PlayCircle },
  IN_PROGRESS: { next: "COMPLETED", label: "Complete Trip", icon: CheckCircle },
};

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  ASSIGNED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  IN_PROGRESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  NO_SHOW: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

export default function DriverDashboard() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>("today");
  const [selectedDate, setSelectedDate] = useState(getToday());

  const profileQuery = useQuery<any>({
    queryKey: ["/api/driver/profile"],
    queryFn: () => apiFetch("/api/driver/profile", token),
    enabled: !!token,
  });

  const tripsQuery = useQuery<any>({
    queryKey: ["/api/driver/my-trips", selectedDate],
    queryFn: () => apiFetch(`/api/driver/my-trips?date=${selectedDate}`, token),
    enabled: !!token,
    refetchInterval: 30000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ tripId, status }: { tripId: number; status: string }) =>
      apiFetch(`/api/trips/${tripId}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      toast({ title: "Trip status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const driver = profileQuery.data?.driver;
  const vehicle = profileQuery.data?.vehicle;
  const todayTrips = tripsQuery.data?.todayTrips || [];
  const allTrips = tripsQuery.data?.allTrips || [];

  const activeTrips = todayTrips.filter((t: any) => ["SCHEDULED", "ASSIGNED", "IN_PROGRESS"].includes(t.status));
  const completedToday = todayTrips.filter((t: any) => t.status === "COMPLETED");

  return (
    <div className="p-4 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Car className="w-6 h-6" />
        <h1 className="text-xl font-semibold" data-testid="text-driver-dashboard-title">
          Driver Dashboard
        </h1>
      </div>

      {profileQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : driver ? (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium" data-testid="text-driver-name">{driver.firstName} {driver.lastName}</p>
                  <p className="text-xs text-muted-foreground">{driver.publicId}</p>
                </div>
              </div>
              {vehicle && (
                <div className="flex items-center gap-2">
                  <Car className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm" data-testid="text-vehicle-name">{vehicle.name}</p>
                    <p className="text-xs text-muted-foreground">{vehicle.licensePlate}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Badge variant={driver.dispatchStatus === "available" ? "default" : "secondary"} data-testid="badge-dispatch-status">
                  {driver.dispatchStatus}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center">
            <AlertTriangle className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground" data-testid="text-no-driver-profile">No driver profile linked to your account.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <Button
          variant={activeTab === "today" ? "default" : "outline"}
          onClick={() => setActiveTab("today")}
          data-testid="button-tab-today"
        >
          <CalendarDays className="w-4 h-4 mr-2" />
          Today's Trips
        </Button>
        <Button
          variant={activeTab === "history" ? "default" : "outline"}
          onClick={() => setActiveTab("history")}
          data-testid="button-tab-history"
        >
          <History className="w-4 h-4 mr-2" />
          Trip History
        </Button>
      </div>

      {activeTab === "today" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Label>Date</Label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-auto"
              data-testid="input-driver-date"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold" data-testid="text-total-trips">{todayTrips.length}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold" data-testid="text-active-trips">{activeTrips.length}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold" data-testid="text-completed-trips">{completedToday.length}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold" data-testid="text-pending-trips">{todayTrips.filter((t: any) => t.status === "SCHEDULED").length}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </CardContent>
            </Card>
          </div>

          {tripsQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : todayTrips.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <CalendarDays className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground" data-testid="text-no-trips">No trips scheduled for this date.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {todayTrips.map((trip: any) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onStatusChange={(status) => statusMutation.mutate({ tripId: trip.id, status })}
                  isPending={statusMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-3">
          {allTrips.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <History className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground" data-testid="text-no-history">No trip history available.</p>
              </CardContent>
            </Card>
          ) : (
            allTrips.map((trip: any) => (
              <TripCard key={trip.id} trip={trip} readonly />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TripCard({
  trip,
  onStatusChange,
  isPending,
  readonly,
}: {
  trip: any;
  onStatusChange?: (status: string) => void;
  isPending?: boolean;
  readonly?: boolean;
}) {
  const statusAction = STATUS_FLOW[trip.status];
  const statusColorClass = STATUS_COLORS[trip.status] || "";

  return (
    <Card data-testid={`card-trip-${trip.id}`}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-medium" data-testid={`text-trip-id-${trip.id}`}>{trip.publicId}</span>
              <Badge className={statusColorClass} data-testid={`badge-trip-status-${trip.id}`}>
                {trip.status.replace(/_/g, " ")}
              </Badge>
              <Badge variant="outline" className="text-xs capitalize">{trip.tripType?.replace("_", " ")}</Badge>
            </div>

            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" />
              <span data-testid={`text-trip-time-${trip.id}`}>{trip.pickupTime || trip.scheduledTime || "—"}</span>
              <span className="mx-1">|</span>
              <span>{trip.scheduledDate}</span>
            </div>

            <div className="space-y-1">
              <div className="flex items-start gap-1 text-sm">
                <Navigation className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-green-600" />
                <span className="truncate" data-testid={`text-pickup-${trip.id}`}>{trip.pickupAddress || "Pickup not set"}</span>
              </div>
              <div className="flex items-start gap-1 text-sm">
                <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-600" />
                <span className="truncate" data-testid={`text-dropoff-${trip.id}`}>{trip.dropoffAddress || "Dropoff not set"}</span>
              </div>
            </div>
          </div>

          {!readonly && statusAction && onStatusChange && (
            <Button
              onClick={() => onStatusChange(statusAction.next)}
              disabled={isPending}
              data-testid={`button-trip-action-${trip.id}`}
            >
              <statusAction.icon className="w-4 h-4 mr-2" />
              {statusAction.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
