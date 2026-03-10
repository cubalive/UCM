import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, AlertTriangle, Phone, Mail, MapPin, User, Building2, Brain, Shield, Truck, BarChart3, Radar, Loader2, Save, Navigation } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { AddressAutocomplete, StructuredAddress } from "@/components/address-autocomplete";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ClinicDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { token, user } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const canConfigureClinic = ["SUPER_ADMIN", "ADMIN", "DISPATCH"].includes(user?.role || "");

  const { data: clinic, isLoading, error } = useQuery<any>({
    queryKey: ["/api/clinics", id],
    queryFn: () => apiFetch(`/api/clinics/${id}`, token),
    enabled: !!token && id > 0,
  });

  const { data: featuresData } = useQuery<any>({
    queryKey: ["/api/admin/clinic-features", id],
    queryFn: () => apiFetch(`/api/admin/clinic-features/${id}`, token),
    enabled: !!token && id > 0 && isSuperAdmin,
  });

  const featureToggleMutation = useMutation({
    mutationFn: async (params: { featureKey: string; enabled: boolean; plan?: string; priceCents?: number }) => {
      return apiRequest("POST", `/api/admin/clinic-features/${id}`, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clinic-features", id] });
      toast({ title: "Feature updated", description: "Clinic feature configuration saved." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update feature", variant: "destructive" });
    },
  });

  const [locationAddr, setLocationAddr] = useState<StructuredAddress | null>(null);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");

  const updateLocationMutation = useMutation({
    mutationFn: async (data: { lat: number; lng: number; address?: string; addressStreet?: string; addressCity?: string; addressState?: string; addressZip?: string; addressPlaceId?: string }) => {
      return apiRequest("PATCH", `/api/clinics/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinics", id] });
      toast({ title: "Location updated", description: "Clinic coordinates saved. Arrival Radar is now active." });
      setLocationAddr(null);
      setManualLat("");
      setManualLng("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update location", variant: "destructive" });
    },
  });

  function handleSaveLocationFromAutocomplete() {
    if (!locationAddr || !locationAddr.lat || !locationAddr.lng) {
      toast({ title: "Please select an address from suggestions", variant: "destructive" });
      return;
    }
    updateLocationMutation.mutate({
      lat: locationAddr.lat,
      lng: locationAddr.lng,
      address: locationAddr.formattedAddress,
      addressStreet: locationAddr.street,
      addressCity: locationAddr.city,
      addressState: locationAddr.state,
      addressZip: locationAddr.zip,
      addressPlaceId: locationAddr.placeId,
    });
  }

  function handleSaveManualCoords() {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      toast({ title: "Invalid coordinates", description: "Latitude must be -90 to 90, longitude -180 to 180", variant: "destructive" });
      return;
    }
    updateLocationMutation.mutate({ lat, lng });
  }

  const features = (featuresData as any)?.features || [];
  const intelligenceFeature = features.find((f: any) => f.featureKey === "clinic_intelligence_pack");
  const intelligenceEnabled = intelligenceFeature?.enabled === true;

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

      {canConfigureClinic && (
        <Card data-testid="clinic-location-section">
          <CardContent className="py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-cyan-500/10 rounded-lg flex items-center justify-center">
                  <Radar className="w-5 h-5 text-cyan-500" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Location & Arrival Radar</h3>
                  <p className="text-xs text-muted-foreground">Set clinic coordinates for live driver tracking map</p>
                </div>
              </div>
              <Badge variant={clinic.lat && clinic.lng ? "default" : "destructive"} data-testid="badge-location-status">
                {clinic.lat && clinic.lng ? "Configured" : "Not Set"}
              </Badge>
            </div>

            {clinic.lat && clinic.lng ? (
              <div className="bg-muted/50 rounded-lg p-3 space-y-2 border">
                <div className="flex items-center gap-2 text-sm">
                  <Navigation className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="font-medium">Current Coordinates</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Latitude</span>
                    <p className="font-mono text-xs" data-testid="text-clinic-lat">{clinic.lat}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Longitude</span>
                    <p className="font-mono text-xs" data-testid="text-clinic-lng">{clinic.lng}</p>
                  </div>
                </div>
                {clinic.address && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    {clinic.address}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-destructive">Arrival Radar inactive</p>
                  <p className="text-xs text-muted-foreground">Set the clinic location below to enable live driver tracking on the clinic portal dashboard.</p>
                </div>
              </div>
            )}

            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Update Location</p>
              <AddressAutocomplete
                label="Search Clinic Address"
                value={locationAddr}
                onSelect={setLocationAddr}
                token={token}
                testIdPrefix="clinic-location"
                allowManualOverride={false}
              />
              {locationAddr && (
                <Button
                  onClick={handleSaveLocationFromAutocomplete}
                  disabled={updateLocationMutation.isPending}
                  className="w-full"
                  data-testid="button-save-clinic-location"
                >
                  {updateLocationMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Location
                </Button>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors py-1">
                  Or enter coordinates manually
                </summary>
                <div className="pt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Latitude</Label>
                      <Input
                        type="text"
                        placeholder="e.g. 36.1699"
                        value={manualLat}
                        onChange={(e) => setManualLat(e.target.value)}
                        data-testid="input-manual-lat"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Longitude</Label>
                      <Input
                        type="text"
                        placeholder="e.g. -115.1398"
                        value={manualLng}
                        onChange={(e) => setManualLng(e.target.value)}
                        data-testid="input-manual-lng"
                      />
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveManualCoords}
                    disabled={updateLocationMutation.isPending || !manualLat || !manualLng}
                    className="w-full"
                    data-testid="button-save-manual-coords"
                  >
                    {updateLocationMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Save Coordinates
                  </Button>
                </div>
              </details>
            </div>
          </CardContent>
        </Card>
      )}

      {canConfigureClinic && (
        <Card data-testid="clinic-intelligence-section">
          <CardContent className="py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <Brain className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Clinic Intelligence Pack</h3>
                  <p className="text-xs text-muted-foreground">Predictive load forecasting, capacity planning & analytics</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={intelligenceEnabled ? "default" : "secondary"} data-testid="badge-intelligence-status">
                  {intelligenceEnabled ? "Active" : "Disabled"}
                </Badge>
                <Switch
                  checked={intelligenceEnabled}
                  onCheckedChange={(checked) => {
                    featureToggleMutation.mutate({
                      featureKey: "clinic_intelligence_pack",
                      enabled: checked,
                      plan: checked ? "active" : "none",
                      priceCents: 9900,
                    });
                  }}
                  disabled={featureToggleMutation.isPending}
                  data-testid="switch-intelligence-toggle"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t">
              <div className="flex items-start gap-2 text-xs">
                <Brain className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Dialysis Load Predictor</p>
                  <p className="text-muted-foreground">15-min bucket forecasts with confidence scoring</p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <Truck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Capacity Forecast</p>
                  <p className="text-muted-foreground">Driver needs + shortage risk detection</p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <BarChart3 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Audit Trail</p>
                  <p className="text-muted-foreground">Daily snapshots for accuracy evaluation</p>
                </div>
              </div>
            </div>

            {intelligenceEnabled && intelligenceFeature?.activatedAt && (
              <div className="text-xs text-muted-foreground pt-2 border-t flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" />
                Activated {formatDate(intelligenceFeature.activatedAt)}
                {intelligenceFeature.priceCents && ` — $${(intelligenceFeature.priceCents / 100).toFixed(2)}/mo`}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
