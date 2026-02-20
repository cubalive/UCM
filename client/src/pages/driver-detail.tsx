import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertTriangle, Phone, Mail, IdCard } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { VehicleRef } from "@/components/entity-ref";

export default function DriverDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { token } = useAuth();

  const { data: driver, isLoading, error } = useQuery<any>({
    queryKey: ["/api/drivers", id],
    queryFn: () => apiFetch(`/api/drivers/${id}`, token),
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

  if (error || !driver) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <Button variant="ghost" onClick={() => navigate("/drivers")} data-testid="button-back-drivers">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Drivers
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground" data-testid="text-driver-not-found">Driver not found or access denied.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusVariant = driver.active ? "default" : "destructive";
  const statusLabel = driver.active ? "Active" : "Inactive";

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto overflow-y-auto h-full" data-testid="driver-detail-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/drivers")} data-testid="button-back-drivers">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg font-semibold" data-testid="text-driver-name">
            {driver.firstName} {driver.lastName}
          </span>
          {driver.publicId && (
            <span className="text-sm font-mono text-muted-foreground" data-testid="text-driver-public-id">
              {driver.publicId}
            </span>
          )}
          <Badge variant={statusVariant as any} data-testid="badge-driver-status">
            {statusLabel}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Contact Information</h3>

            {driver.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span data-testid="text-driver-phone">{driver.phone}</span>
              </div>
            )}

            {driver.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span data-testid="text-driver-email">{driver.email}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Details</h3>

            {(driver.vehicleId || driver.vehicleName) && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Vehicle</span>
                <div data-testid="text-driver-vehicle">
                  {driver.vehicleId ? (
                    <VehicleRef id={driver.vehicleId} label={driver.vehicleName || `Vehicle #${driver.vehicleId}`} />
                  ) : (
                    <span className="text-sm">{driver.vehicleName}</span>
                  )}
                </div>
              </div>
            )}

            {driver.companyName && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Company</span>
                <p className="text-sm" data-testid="text-driver-company">{driver.companyName}</p>
              </div>
            )}

            {driver.licenseNumber && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">License</span>
                <div className="flex items-center gap-2 text-sm">
                  <IdCard className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span data-testid="text-driver-license">{driver.licenseNumber}</span>
                </div>
                {driver.licenseExpiry && (
                  <p className="text-xs text-muted-foreground" data-testid="text-driver-license-expiry">
                    Expires: {driver.licenseExpiry}
                  </p>
                )}
              </div>
            )}

            {driver.notes && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Notes</span>
                <p className="text-sm" data-testid="text-driver-notes">{driver.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
