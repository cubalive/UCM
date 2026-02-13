import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { LogOut, Settings } from "lucide-react";
import { Link } from "wouter";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  DISPATCH: "Dispatch",
  DRIVER: "Driver",
  VIEWER: "Viewer",
};

export function DashboardHeader() {
  const { user, selectedCity, logout } = useAuth();
  const roleLabel = ROLE_LABELS[user?.role?.toUpperCase() || ""] || user?.role || "";

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
          United Care Mobility
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center min-w-0">
        {selectedCity && (
          <span
            className="text-sm text-muted-foreground font-medium truncate"
            data-testid="text-header-city"
          >
            {selectedCity.name}, {selectedCity.state}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge variant="secondary" className="hidden sm:inline-flex" data-testid="badge-header-role">
          {roleLabel}
        </Badge>
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
