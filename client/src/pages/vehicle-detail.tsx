import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertTriangle, Truck, Hash } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function VehicleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { token } = useAuth();

  const { data: vehicle, isLoading, error } = useQuery<any>({
    queryKey: ["/api/vehicles", id],
    queryFn: () => apiFetch(`/api/vehicles/${id}`, token),
    enabled: !!token && id > 0,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !vehicle) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <Button variant="ghost" onClick={() => navigate("/vehicles")} data-testid="button-back-vehicles">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Vehicles
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground" data-testid="text-vehicle-not-found">Vehicle not found or access denied.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusVariant = vehicle.active ? "default" : "destructive";
  const statusLabel = vehicle.active ? "Active" : "Inactive";
  const displayName = vehicle.name || `${vehicle.make || ""} ${vehicle.model || ""}`.trim() || `Vehicle #${vehicle.id}`;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto overflow-y-auto h-full" data-testid="vehicle-detail-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/vehicles")} data-testid="button-back-vehicles">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <Truck className="w-5 h-5 text-muted-foreground" />
          <span className="text-lg font-semibold" data-testid="text-vehicle-name">
            {displayName}
          </span>
          <Badge variant={statusVariant as any} data-testid="badge-vehicle-status">
            {statusLabel}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Vehicle Information</h3>

            {vehicle.plate && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">License Plate</span>
                <p className="text-sm font-mono font-medium" data-testid="text-vehicle-plate">{vehicle.plate}</p>
              </div>
            )}

            {vehicle.vin && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">VIN</span>
                <div className="flex items-center gap-2 text-sm">
                  <Hash className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-mono" data-testid="text-vehicle-vin">{vehicle.vin}</span>
                </div>
              </div>
            )}

            {vehicle.type && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Type</span>
                <p className="text-sm" data-testid="text-vehicle-type">{vehicle.type}</p>
              </div>
            )}

            {(vehicle.make || vehicle.model) && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Make / Model</span>
                <p className="text-sm" data-testid="text-vehicle-make-model">
                  {[vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                </p>
              </div>
            )}

            {vehicle.year && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Year</span>
                <p className="text-sm" data-testid="text-vehicle-year">{vehicle.year}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Details</h3>

            {vehicle.capacity != null && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Capacity</span>
                <p className="text-sm" data-testid="text-vehicle-capacity">{vehicle.capacity}</p>
              </div>
            )}

            {vehicle.wheelchairAccessible != null && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Wheelchair Accessible</span>
                <Badge variant="outline" data-testid="badge-vehicle-wheelchair">
                  {vehicle.wheelchairAccessible ? "Yes" : "No"}
                </Badge>
              </div>
            )}

            {vehicle.companyName && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Company</span>
                <p className="text-sm" data-testid="text-vehicle-company">{vehicle.companyName}</p>
              </div>
            )}

            {vehicle.notes && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Notes</span>
                <p className="text-sm" data-testid="text-vehicle-notes">{vehicle.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
