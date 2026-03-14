import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin } from "lucide-react";

export function CitySelectionModal() {
  const { cities, selectWorkingCity, isSuperAdmin, user } = useAuth();
  const [selectedId, setSelectedId] = useState<string>("");

  const handleContinue = () => {
    if (selectedId === "all" && isSuperAdmin) {
      selectWorkingCity(null);
      return;
    }
    const city = cities.find((c) => String(c.id) === selectedId);
    if (city) {
      selectWorkingCity(city);
    }
  };

  const activeCities = cities.filter((c) => c.active !== false);

  if (activeCities.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background" data-testid="city-selection-empty">
        <Card className="w-full max-w-md mx-4">
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-lg">No Cities Available</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {user?.role === "SUPER_ADMIN"
                ? "No service cities have been set up. Go to City Management to create one."
                : user?.role === "DISPATCH"
                  ? "You have not been assigned access to any cities yet. Your Company Admin needs to grant you city access permissions before you can use the dispatch system."
                  : "No service cities are assigned to your account. Please contact your administrator."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background" data-testid="city-selection-modal">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Select Your Working City</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Choose the city you want to work in. All data will be filtered to this city.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger data-testid="select-working-city">
              <SelectValue placeholder="Choose a city..." />
            </SelectTrigger>
            <SelectContent>
              {isSuperAdmin && (
                <SelectItem value="all" data-testid="select-city-all">
                  All Cities
                </SelectItem>
              )}
              {Object.entries(
                activeCities.reduce<Record<string, typeof activeCities>>((acc, city) => {
                  const st = city.state || "Other";
                  if (!acc[st]) acc[st] = [];
                  acc[st].push(city);
                  return acc;
                }, {})
              )
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([state, stateCities]) => (
                  <SelectGroup key={state}>
                    <SelectLabel>{state}</SelectLabel>
                    {stateCities.map((city) => (
                      <SelectItem key={city.id} value={String(city.id)} data-testid={`select-city-${city.id}`}>
                        {city.name}, {city.state}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
            </SelectContent>
          </Select>
          <Button
            className="w-full"
            disabled={!selectedId}
            onClick={handleContinue}
            data-testid="button-city-continue"
          >
            Continue
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
