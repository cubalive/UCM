import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertTriangle, Phone, Mail, MapPin, Accessibility } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ClinicRef } from "@/components/entity-ref";

const STATUS_VARIANTS: Record<string, string> = {
  SCHEDULED: "secondary",
  ASSIGNED: "default",
  IN_PROGRESS: "default",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
};

export default function PatientDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { token, selectedCity } = useAuth();

  const { data: patient, isLoading, error } = useQuery<any>({
    queryKey: ["/api/patients", id],
    queryFn: () => apiFetch(`/api/patients/${id}`, token),
    enabled: !!token && id > 0,
  });

  const { data: tripsData } = useQuery<any>({
    queryKey: ["/api/trips", "for-patient", id, selectedCity?.id],
    queryFn: async () => {
      const url = selectedCity?.id
        ? `/api/trips?cityId=${selectedCity.id}`
        : `/api/trips`;
      const result = await apiFetch(url, token);
      const trips = Array.isArray(result) ? result : result?.trips || [];
      return trips.filter((t: any) => t.patientId === id);
    },
    enabled: !!token && id > 0 && !!patient,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <Button variant="ghost" onClick={() => navigate("/patients")} data-testid="button-back-patients">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Patients
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground" data-testid="text-patient-not-found">Patient not found or access denied.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const relatedTrips = tripsData || [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto overflow-y-auto h-full" data-testid="patient-detail-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/patients")} data-testid="button-back-patients">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg font-semibold" data-testid="text-patient-name">
            {patient.firstName} {patient.lastName}
          </span>
          {patient.publicId && (
            <span className="text-sm font-mono text-muted-foreground" data-testid="text-patient-public-id">
              {patient.publicId}
            </span>
          )}
          {patient.mobilityRequirement && patient.mobilityRequirement !== "STANDARD" && (
            <Badge variant="outline" data-testid="badge-mobility-requirement">
              <Accessibility className="w-3 h-3 mr-1" />
              {patient.mobilityRequirement}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Contact Information</h3>

            {patient.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span data-testid="text-patient-phone">{patient.phone}</span>
              </div>
            )}

            {patient.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span data-testid="text-patient-email">{patient.email}</span>
              </div>
            )}

            {patient.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span data-testid="text-patient-address">{patient.address}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Details</h3>

            {patient.clinicName && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Clinic</span>
                <div data-testid="text-patient-clinic">
                  {patient.clinicId ? (
                    <ClinicRef id={patient.clinicId} label={patient.clinicName} />
                  ) : (
                    <span className="text-sm">{patient.clinicName}</span>
                  )}
                </div>
              </div>
            )}

            {patient.companyName && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Company</span>
                <p className="text-sm" data-testid="text-patient-company">{patient.companyName}</p>
              </div>
            )}

            {patient.notes && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Notes</span>
                <p className="text-sm" data-testid="text-patient-notes">{patient.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {relatedTrips.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground" data-testid="text-related-trips-heading">
            Related Trips ({relatedTrips.length})
          </h3>
          <div className="space-y-2">
            {relatedTrips.map((trip: any) => (
              <Card
                key={trip.id}
                className="hover-elevate cursor-pointer"
                onClick={() => navigate(`/trips/${trip.id}`)}
                data-testid={`card-trip-${trip.id}`}
              >
                <CardContent className="py-3 flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-sm font-medium" data-testid={`text-trip-public-id-${trip.id}`}>
                    {trip.publicId || `#${trip.id}`}
                  </span>
                  <Badge
                    variant={(STATUS_VARIANTS[trip.status] as any) || "secondary"}
                    data-testid={`badge-trip-status-${trip.id}`}
                  >
                    {trip.status?.replace(/_/g, " ")}
                  </Badge>
                  {trip.scheduledDate && (
                    <span className="text-xs text-muted-foreground" data-testid={`text-trip-date-${trip.id}`}>
                      {trip.scheduledDate}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]" data-testid={`text-trip-pickup-${trip.id}`}>
                    {trip.pickupAddress}
                  </span>
                  <span className="text-xs text-muted-foreground">→</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]" data-testid={`text-trip-dropoff-${trip.id}`}>
                    {trip.dropoffAddress}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
