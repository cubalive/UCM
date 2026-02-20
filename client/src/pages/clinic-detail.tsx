import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertTriangle, Phone, Mail, MapPin, User, Building2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function ClinicDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { token } = useAuth();

  const { data: clinic, isLoading, error } = useQuery<any>({
    queryKey: ["/api/clinics", id],
    queryFn: () => apiFetch(`/api/clinics/${id}`, token),
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

  if (error || !clinic) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <Button variant="ghost" onClick={() => navigate("/clinics")} data-testid="button-back-clinics">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Clinics
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground" data-testid="text-clinic-not-found">Clinic not found or access denied.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto overflow-y-auto h-full" data-testid="clinic-detail-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/clinics")} data-testid="button-back-clinics">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <Building2 className="w-5 h-5 text-muted-foreground" />
          <span className="text-lg font-semibold" data-testid="text-clinic-name">
            {clinic.name}
          </span>
          {clinic.publicId && (
            <span className="text-sm font-mono text-muted-foreground" data-testid="text-clinic-public-id">
              {clinic.publicId}
            </span>
          )}
          {clinic.active != null && (
            <Badge variant={clinic.active ? "default" : "destructive"} data-testid="badge-clinic-status">
              {clinic.active ? "Active" : "Inactive"}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Contact Information</h3>

            {clinic.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span data-testid="text-clinic-phone">{clinic.phone}</span>
              </div>
            )}

            {clinic.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span data-testid="text-clinic-email">{clinic.email}</span>
              </div>
            )}

            {clinic.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span data-testid="text-clinic-address">{clinic.address}</span>
              </div>
            )}

            {clinic.contactPerson && (
              <div className="flex items-center gap-2 text-sm">
                <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span data-testid="text-clinic-contact-person">{clinic.contactPerson}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Details</h3>

            {clinic.companyName && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Company</span>
                <p className="text-sm" data-testid="text-clinic-company">{clinic.companyName}</p>
              </div>
            )}

            {clinic.npi && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">NPI</span>
                <p className="text-sm font-mono" data-testid="text-clinic-npi">{clinic.npi}</p>
              </div>
            )}

            {clinic.notes && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Notes</span>
                <p className="text-sm" data-testid="text-clinic-notes">{clinic.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
