import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LogOut, Settings, MapPin } from "lucide-react";
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useTranslation } from "react-i18next";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  DISPATCH: "Dispatch",
  DRIVER: "Driver",
  VIEWER: "Viewer",
};

export function DashboardHeader() {
  const { user, selectedCity, cities, setSelectedCity, isSuperAdmin, logout } = useAuth();
  const { t } = useTranslation();
  const roleLabel = ROLE_LABELS[user?.role?.toUpperCase() || ""] || user?.role || "";

  const needsCitySwitcher =
    user &&
    ["SUPER_ADMIN", "ADMIN", "DISPATCH"].includes(user.role.toUpperCase());

  const activeCities = cities.filter((c) => c.active !== false);

  const handleCityChange = (val: string) => {
    if (val === "all") {
      setSelectedCity(null);
    } else {
      const city = cities.find((c) => String(c.id) === val);
      if (city) setSelectedCity(city);
    }
    queryClient.invalidateQueries();
  };

  return (
    <header
      className="flex items-center gap-2 h-16 px-3 border-b bg-background flex-shrink-0 shadow-sm"
      style={{ zIndex: 50 }}
      data-testid="dashboard-header"
    >
      <SidebarTrigger data-testid="button-sidebar-toggle" />

      <div className="flex items-center gap-2 ml-1">
        <img
          src="/branding/logo-small.png"
          alt="UCM"
          className="h-8 w-auto flex-shrink-0"
          data-testid="img-header-logo"
        />
        <span
          className="text-sm font-semibold hidden sm:inline truncate"
          data-testid="text-header-title"
        >
          {t("app.title")}
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center min-w-0">
        {needsCitySwitcher ? (
          <div className="flex items-center gap-1.5" data-testid="city-switcher">
            <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Select
              value={selectedCity ? String(selectedCity.id) : "all"}
              onValueChange={handleCityChange}
            >
              <SelectTrigger className="w-[200px] h-8 text-sm" data-testid="select-header-city">
                <SelectValue placeholder={t("common.selectCity")} />
              </SelectTrigger>
              <SelectContent>
                {isSuperAdmin && (
                  <SelectItem value="all" data-testid="select-header-city-all">
                    {t("common.allCities")}
                  </SelectItem>
                )}
                {activeCities.map((city) => (
                  <SelectItem key={city.id} value={String(city.id)} data-testid={`select-header-city-${city.id}`}>
                    {city.name}, {city.state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : selectedCity ? (
          <span
            className="text-sm text-muted-foreground font-medium truncate"
            data-testid="text-header-city"
          >
            {selectedCity.name}, {selectedCity.state}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <Badge variant="secondary" className="hidden sm:inline-flex" data-testid="badge-header-role">
          {roleLabel}
        </Badge>
        <LanguageSwitcher />
        <ThemeToggle />
        <Link href="/users">
          <Button size="icon" variant="ghost" data-testid="button-header-settings">
            <Settings className="w-4 h-4" />
          </Button>
        </Link>
        <Button size="icon" variant="ghost" onClick={logout} data-testid="button-header-logout">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
