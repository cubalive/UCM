import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Clock,
  MapPin,
  User,
  Navigation,
  ArrowRight,
  Car,
  Phone,
  CheckCircle,
  ArrowLeft,
  Lock,
  Radio,
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
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  EN_ROUTE_TO_PICKUP: "En Route to Pickup",
  ARRIVED_PICKUP: "Arrived at Pickup",
  PICKED_UP: "Picked Up",
  EN_ROUTE_TO_DROPOFF: "En Route to Dropoff",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const TRIP_PROGRESS_STEPS = [
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "EN_ROUTE_TO_PICKUP", label: "Driver En Route" },
  { key: "ARRIVED_PICKUP", label: "Arrived Pickup" },
  { key: "PICKED_UP", label: "Picked Up" },
  { key: "EN_ROUTE_TO_DROPOFF", label: "En Route Dropoff" },
  { key: "COMPLETED", label: "Completed" },
];

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

export default function ClinicTripsPage() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState("active");
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);

  const tripsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/trips", activeTab],
    queryFn: () => apiFetch(`/api/clinic/trips?status=${activeTab}`, token),
    enabled: !!token,
    refetchInterval: activeTab === "active" ? 15000 : 30000,
  });

  const tripDetailQuery = useQuery<any>({
    queryKey: ["/api/clinic/trips", selectedTripId],
    queryFn: () => apiFetch(`/api/clinic/trips/${selectedTripId}`, token),
    enabled: !!token && !!selectedTripId,
    refetchInterval: 30000,
  });

  const trips = tripsQuery.data || [];

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-clinic-trips-title">
          My Trips
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track your patient transportation
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="active" data-testid="tab-clinic-active">
            Active Trips
          </TabsTrigger>
          <TabsTrigger value="scheduled" data-testid="tab-clinic-scheduled">
            Scheduled
          </TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-clinic-completed">
            Completed
          </TabsTrigger>
        </TabsList>

        {["active", "scheduled", "completed"].map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            {tripsQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
              </div>
            ) : trips.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground" data-testid={`text-empty-clinic-${tab}`}>
                No {tab} trips
              </div>
            ) : (
              <div className="space-y-2" data-testid={`list-clinic-${tab}-trips`}>
                {trips.map((trip) => (
                  <ClinicTripCard
                    key={trip.id}
                    trip={trip}
                    isCompleted={tab === "completed"}
                    onSelect={() => setSelectedTripId(trip.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!selectedTripId} onOpenChange={(open) => { if (!open) setSelectedTripId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Trip Details
              {tripDetailQuery.data && (
                <Badge className={STATUS_COLORS[tripDetailQuery.data.status] || ""}>
                  {STATUS_LABELS[tripDetailQuery.data.status] || tripDetailQuery.data.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {tripDetailQuery.isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : tripDetailQuery.data ? (
            <TripDetail trip={tripDetailQuery.data} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClinicTripCard({ trip, isCompleted, onSelect }: { trip: any; isCompleted: boolean; onSelect: () => void }) {
  return (
    <Card
      className="cursor-pointer hover-elevate"
      onClick={onSelect}
      data-testid={`card-clinic-trip-${trip.id}`}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{trip.publicId}</span>
              <Badge className={STATUS_COLORS[trip.status] || ""}>
                {STATUS_LABELS[trip.status] || trip.status}
              </Badge>
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
              {trip.pickupTime && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  {trip.pickupTime} on {trip.scheduledDate}
                </span>
              )}
              {trip.driverName && (
                <span className="flex items-center gap-1 text-foreground font-medium">
                  <Car className="w-3 h-3 flex-shrink-0" />
                  {trip.driverName}
                </span>
              )}
              {trip.lastEtaMinutes != null && (
                <span className="flex items-center gap-1 font-medium text-foreground">
                  <Navigation className="w-3 h-3 flex-shrink-0" />
                  ETA: {trip.lastEtaMinutes} min
                </span>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{trip.pickupAddress}</span>
                <ArrowRight className="w-3 h-3 flex-shrink-0 mx-0.5" />
                <span className="truncate">{trip.dropoffAddress}</span>
              </span>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={onSelect} data-testid={`button-view-trip-${trip.id}`}>
            View
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TripDetail({ trip }: { trip: any }) {
  const isCompleted = trip.status === "COMPLETED" || trip.status === "CANCELLED";
  const currentStepIndex = TRIP_PROGRESS_STEPS.findIndex((s) => s.key === trip.status);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-semibold">{trip.publicId}</span>
          {trip.patientName && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> {trip.patientName}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 mt-0.5 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Pickup</p>
              <p>{trip.pickupAddress}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Dropoff</p>
              <p>{trip.dropoffAddress}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm flex-wrap">
          {trip.pickupTime && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {trip.pickupTime} on {trip.scheduledDate}
            </span>
          )}
          {trip.lastEtaMinutes != null && (
            <span className="flex items-center gap-1 font-medium">
              <Navigation className="w-3.5 h-3.5 text-blue-500" />
              ETA: {trip.lastEtaMinutes} min
            </span>
          )}
        </div>
      </div>

      {trip.driverName && (
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Driver</p>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-0.5">
                <p className="text-sm font-medium flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {trip.driverName}
                </p>
                {trip.vehicleLabel && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Car className="w-3 h-3" />
                    {trip.vehicleLabel}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {trip.driverLastSeenAt && (
                  <span className="flex items-center gap-1">
                    <Radio className="w-3 h-3" />
                    GPS: {formatTimeAgo(trip.driverLastSeenAt)}
                  </span>
                )}
                {trip.driverPhone && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {trip.driverPhone}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <p className="text-xs text-muted-foreground mb-2">Trip Progress</p>
        <div className="space-y-1">
          {TRIP_PROGRESS_STEPS.map((step, idx) => {
            const isPast = idx <= currentStepIndex;
            const isCurrent = idx === currentStepIndex;
            return (
              <div
                key={step.key}
                className={`flex items-center gap-2 py-1 px-2 rounded text-sm ${
                  isCurrent
                    ? "bg-primary/10 font-medium text-primary"
                    : isPast
                    ? "text-muted-foreground"
                    : "text-muted-foreground/40"
                }`}
                data-testid={`step-${step.key}`}
              >
                {isPast ? (
                  <CheckCircle className={`w-4 h-4 flex-shrink-0 ${isCurrent ? "text-primary" : "text-emerald-500"}`} />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
                )}
                <span>{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {trip.notes && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-sm">{trip.notes}</p>
        </div>
      )}

      {isCompleted && (
        <div className="text-center py-2">
          <Badge variant="secondary" className="gap-1">
            <Lock className="w-3 h-3" />
            This trip is completed and locked
          </Badge>
        </div>
      )}
    </div>
  );
}
