import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Power,
  PowerOff,
  MapPinOff,
  Send,
  MessageSquare,
  Lock,
  ArrowRight,
  PhoneCall,
  LocateFixed,
} from "lucide-react";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

type TabType = "today" | "history";

const STATUS_FLOW: Record<string, { next: string; label: string; icon: any }> = {
  ASSIGNED: { next: "EN_ROUTE_TO_PICKUP", label: "Start Trip", icon: PlayCircle },
  EN_ROUTE_TO_PICKUP: { next: "ARRIVED_PICKUP", label: "Arrived at Pickup", icon: MapPin },
  ARRIVED_PICKUP: { next: "PICKED_UP", label: "Picked Up Patient", icon: User },
  PICKED_UP: { next: "EN_ROUTE_TO_DROPOFF", label: "En Route to Dropoff", icon: Navigation },
  EN_ROUTE_TO_DROPOFF: { next: "ARRIVED_DROPOFF", label: "Arrived at Dropoff", icon: MapPin },
  ARRIVED_DROPOFF: { next: "COMPLETED", label: "Complete Trip", icon: CheckCircle },
  IN_PROGRESS: { next: "COMPLETED", label: "Complete Trip", icon: CheckCircle },
};

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  ASSIGNED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  EN_ROUTE_TO_PICKUP: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  ARRIVED_PICKUP: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  PICKED_UP: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  EN_ROUTE_TO_DROPOFF: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  ARRIVED_DROPOFF: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  IN_PROGRESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  NO_SHOW: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  EN_ROUTE_TO_PICKUP: "En Route to Pickup",
  ARRIVED_PICKUP: "Arrived at Pickup",
  PICKED_UP: "Picked Up",
  EN_ROUTE_TO_DROPOFF: "En Route to Dropoff",
  ARRIVED_DROPOFF: "Arrived at Dropoff",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};

const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];

function useGeolocation(isActive: boolean) {
  const [permission, setPermission] = useState<"granted" | "denied" | "prompt" | "unknown">("unknown");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [watchError, setWatchError] = useState(false);
  const watchRef = useRef<number | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (!navigator.geolocation) {
      setPermission("denied");
      return;
    }
    navigator.permissions?.query({ name: "geolocation" }).then((result) => {
      setPermission(result.state);
      result.onchange = () => setPermission(result.state);
    }).catch(() => {
      setPermission("prompt");
    });
  }, []);

  const requestPermission = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setPermission("granted");
        setWatchError(false);
        retryCountRef.current = 0;
      },
      (err) => {
        if (err.code === 1) {
          setPermission("denied");
        } else {
          setPermission("prompt");
        }
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, []);

  useEffect(() => {
    if (permission === "denied" || permission === "granted") return;
    if (!navigator.geolocation) return;
    requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!isActive || !navigator.geolocation || permission !== "granted") return;

    const startWatch = () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
      }
      setWatchError(false);
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setWatchError(false);
          retryCountRef.current = 0;
        },
        () => {
          setWatchError(true);
          const delay = Math.min(5000 * Math.pow(2, retryCountRef.current), 60000);
          retryCountRef.current++;
          retryRef.current = setTimeout(startWatch, delay);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
      );
    };

    startWatch();

    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
      if (retryRef.current !== null) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, [isActive, permission]);

  return { permission, location, watchError, requestPermission };
}

export default function DriverDashboard() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>("today");
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [chatTripId, setChatTripId] = useState<number | null>(null);

  const profileQuery = useQuery<any>({
    queryKey: ["/api/driver/profile"],
    queryFn: () => apiFetch("/api/driver/profile", token),
    enabled: !!token,
  });

  const tripsQuery = useQuery<any>({
    queryKey: ["/api/driver/my-trips", selectedDate],
    queryFn: () => apiFetch(`/api/driver/my-trips?date=${selectedDate}`, token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const driver = profileQuery.data?.driver;
  const vehicle = profileQuery.data?.vehicle;
  const todayTrips = tripsQuery.data?.todayTrips || [];
  const allTrips = tripsQuery.data?.allTrips || [];

  const isDriverActive = driver?.dispatchStatus === "available";
  const hasActiveTrip = todayTrips.some((t: any) => ACTIVE_STATUSES.includes(t.status));

  const { permission: geoPermission, location: geoLocation, watchError: geoWatchError, requestPermission } = useGeolocation(isDriverActive || hasActiveTrip);

  const locationHeartbeat = useCallback(async () => {
    if (!geoLocation || !token) return;
    try {
      await apiFetch("/api/driver/me/location", token, {
        method: "POST",
        body: JSON.stringify({ lat: geoLocation.lat, lng: geoLocation.lng }),
      });
    } catch {}
  }, [geoLocation, token]);

  useEffect(() => {
    if (!isDriverActive && !hasActiveTrip) return;
    if (!geoLocation) return;
    locationHeartbeat();
    const interval = setInterval(locationHeartbeat, 12000);
    return () => clearInterval(interval);
  }, [isDriverActive, hasActiveTrip, locationHeartbeat, geoLocation]);

  const toggleActiveMutation = useMutation({
    mutationFn: (active: boolean) =>
      apiFetch("/api/driver/me/active", token, {
        method: "POST",
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/profile"] });
      toast({ title: isDriverActive ? "You are now offline" : "You are now active" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
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

  const activeTrips = todayTrips.filter((t: any) => ACTIVE_STATUSES.includes(t.status));
  const completedToday = todayTrips.filter((t: any) => t.status === "COMPLETED");

  if (geoPermission === "prompt" || geoPermission === "unknown") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 text-center space-y-4">
            <LocateFixed className="w-12 h-12 mx-auto text-primary" />
            <h2 className="text-lg font-semibold" data-testid="text-location-prompt">Enable Location</h2>
            <p className="text-sm text-muted-foreground">
              Location access is required to manage trips, update your position, and appear on the dispatch map.
            </p>
            <Button onClick={requestPermission} data-testid="button-enable-location">
              <MapPin className="w-4 h-4 mr-2" />
              Enable Location
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (geoPermission === "denied") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 space-y-4">
            <div className="text-center">
              <MapPinOff className="w-12 h-12 mx-auto text-destructive" />
              <h2 className="text-lg font-semibold mt-3" data-testid="text-location-required">Location Access Denied</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Location permission was denied. Please follow the steps below to enable it, then tap the button to try again.
              </p>
            </div>
            <div className="text-left space-y-2 bg-muted/50 rounded-md p-4">
              <p className="text-sm font-medium">For iPhone / iPad (Safari):</p>
              <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                <li>Open <strong>Settings</strong> on your device</li>
                <li>Scroll down and tap <strong>Safari</strong> (or your browser)</li>
                <li>Tap <strong>Location</strong></li>
                <li>Set to <strong>Allow</strong> or <strong>Ask</strong></li>
                <li>Return here and tap <strong>Try Again</strong></li>
              </ol>
              <p className="text-sm font-medium mt-3">For Android (Chrome):</p>
              <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                <li>Tap the <strong>lock icon</strong> in the address bar</li>
                <li>Tap <strong>Permissions</strong></li>
                <li>Enable <strong>Location</strong></li>
                <li>Reload the page</li>
              </ol>
            </div>
            <div className="flex gap-2 justify-center">
              <Button onClick={requestPermission} data-testid="button-retry-location">
                <LocateFixed className="w-4 h-4 mr-2" />
                Try Again
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()} data-testid="button-reload-location">
                Reload Page
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Car className="w-6 h-6" />
          <h1 className="text-xl font-semibold" data-testid="text-driver-dashboard-title">
            Driver Dashboard
          </h1>
        </div>
        {driver && (
          <Button
            variant={isDriverActive ? "destructive" : "default"}
            onClick={() => toggleActiveMutation.mutate(!isDriverActive)}
            disabled={toggleActiveMutation.isPending}
            data-testid="button-toggle-active"
          >
            {isDriverActive ? <PowerOff className="w-4 h-4 mr-2" /> : <Power className="w-4 h-4 mr-2" />}
            {isDriverActive ? "Go Offline" : "Go Active"}
          </Button>
        )}
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
              <Badge variant={isDriverActive ? "default" : "secondary"} data-testid="badge-dispatch-status">
                {isDriverActive ? "Active" : "Offline"}
              </Badge>
              {geoLocation && !geoWatchError && (
                <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <LocateFixed className="w-3.5 h-3.5" />
                  <span data-testid="text-gps-status">GPS Active</span>
                </div>
              )}
              {geoWatchError && (
                <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span data-testid="text-gps-reconnecting">GPS Reconnecting...</span>
                </div>
              )}
              {!geoLocation && !geoWatchError && geoPermission === "granted" && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <LocateFixed className="w-3.5 h-3.5 animate-pulse" />
                  <span data-testid="text-gps-acquiring">Acquiring GPS...</span>
                </div>
              )}
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
                  onOpenChat={() => setChatTripId(trip.id)}
                  token={token}
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
              <TripCard key={trip.id} trip={trip} readonly token={token} />
            ))
          )}
        </div>
      )}

      {chatTripId && (
        <TripChat
          tripId={chatTripId}
          token={token}
          onClose={() => setChatTripId(null)}
          userId={user?.id}
        />
      )}
    </div>
  );
}

function TripCard({
  trip,
  onStatusChange,
  isPending,
  readonly,
  onOpenChat,
  token,
}: {
  trip: any;
  onStatusChange?: (status: string) => void;
  isPending?: boolean;
  readonly?: boolean;
  onOpenChat?: () => void;
  token?: string | null;
}) {
  const statusAction = STATUS_FLOW[trip.status];
  const statusColorClass = STATUS_COLORS[trip.status] || "";
  const isCompleted = trip.status === "COMPLETED";
  const isCancelled = trip.status === "CANCELLED" || trip.status === "NO_SHOW";
  const isLocked = isCompleted || isCancelled;

  return (
    <Card data-testid={`card-trip-${trip.id}`}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-medium" data-testid={`text-trip-id-${trip.id}`}>{trip.publicId}</span>
              <Badge className={statusColorClass} data-testid={`badge-trip-status-${trip.id}`}>
                {STATUS_LABELS[trip.status] || trip.status.replace(/_/g, " ")}
              </Badge>
              {isLocked && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
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

            {trip.patientName && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <User className="w-3.5 h-3.5" />
                <span>{trip.patientName}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 items-end">
            {!readonly && !isLocked && statusAction && onStatusChange && (
              <Button
                onClick={() => onStatusChange(statusAction.next)}
                disabled={isPending}
                data-testid={`button-trip-action-${trip.id}`}
              >
                <statusAction.icon className="w-4 h-4 mr-2" />
                {statusAction.label}
              </Button>
            )}
            {!isLocked && onOpenChat && ACTIVE_STATUSES.includes(trip.status) && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenChat}
                data-testid={`button-trip-chat-${trip.id}`}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Contact Dispatch
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TripChat({
  tripId,
  token,
  onClose,
  userId,
}: {
  tripId: number;
  token: string | null;
  onClose: () => void;
  userId?: number;
}) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery<any[]>({
    queryKey: ["/api/trips", tripId, "messages"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/messages`, token),
    enabled: !!token,
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: (msg: string) =>
      apiFetch(`/api/trips/${tripId}/messages`, token, {
        method: "POST",
        body: JSON.stringify({ message: msg }),
      }),
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "messages"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data]);

  const messages = messagesQuery.data || [];

  return (
    <div className="fixed inset-0 bg-background/80 z-50 flex items-end justify-center p-4 sm:items-center">
      <Card className="w-full max-w-lg max-h-[80vh] flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Trip Messages</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-chat">
            Close
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto min-h-[200px] space-y-2 pb-2">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No messages yet. Start the conversation.</p>
          ) : (
            messages.map((msg: any) => (
              <div
                key={msg.id}
                className={`flex ${msg.senderId === userId ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-md px-3 py-2 text-sm ${
                    msg.senderId === userId
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                  data-testid={`message-${msg.id}`}
                >
                  <p className="text-xs opacity-70 mb-1">
                    {msg.senderRole === "DRIVER" ? "Driver" : "Dispatch"} - {new Date(msg.createdAt).toLocaleTimeString()}
                  </p>
                  <p>{msg.message}</p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </CardContent>
        <div className="p-3 border-t flex gap-2">
          <Textarea
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="flex-1 min-h-[40px] resize-none"
            rows={1}
            data-testid="input-chat-message"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (message.trim()) sendMutation.mutate(message.trim());
              }
            }}
          />
          <Button
            size="icon"
            onClick={() => { if (message.trim()) sendMutation.mutate(message.trim()); }}
            disabled={sendMutation.isPending || !message.trim()}
            data-testid="button-send-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
