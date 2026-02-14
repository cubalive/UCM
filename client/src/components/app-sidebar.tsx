import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { can, type Resource } from "@shared/permissions";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  LayoutDashboard,
  MapPin,
  Users,
  Truck,
  UserCheck,
  Building2,
  HeartPulse,
  Route,
  ClipboardList,
  LogOut,
  Radio,
  FileText,
  Gauge,
  Map,
  Archive,
  CalendarCheck,
  BarChart3,
} from "lucide-react";

interface NavItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  resource: Resource;
}

const navItems: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, resource: "dashboard" },
  { title: "Dispatch", url: "/dispatch", icon: Radio, resource: "dispatch" },
  { title: "Fleet", url: "/fleet", icon: Gauge, resource: "dispatch" },
  { title: "Assignments", url: "/assignments", icon: CalendarCheck, resource: "dispatch" },
  { title: "Live Map", url: "/live-map", icon: Map, resource: "dispatch" },
  { title: "Trips", url: "/trips", icon: Route, resource: "trips" },
  { title: "Patients", url: "/patients", icon: HeartPulse, resource: "patients" },
  { title: "Drivers", url: "/drivers", icon: UserCheck, resource: "drivers" },
  { title: "Vehicles", url: "/vehicles", icon: Truck, resource: "vehicles" },
  { title: "Clinics", url: "/clinics", icon: Building2, resource: "clinics" },
  { title: "Invoices", url: "/invoices", icon: FileText, resource: "invoices" },
];

const adminItems: NavItem[] = [
  { title: "Cities", url: "/cities", icon: MapPin, resource: "cities" },
  { title: "Users", url: "/users", icon: Users, resource: "users" },
  { title: "Reports", url: "/reports", icon: BarChart3, resource: "audit" },
  { title: "Audit Log", url: "/audit", icon: ClipboardList, resource: "audit" },
  { title: "Archive", url: "/archive", icon: Archive, resource: "audit" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, cities, selectedCity, setSelectedCity, logout } = useAuth();

  const role = user?.role || "";

  const upperRole = role.toUpperCase();
  const visibleNav = navItems.filter((item) => {
    if (item.url === "/live-map" && ["VIEWER", "DRIVER"].includes(upperRole)) return true;
    return can(role, item.resource);
  });
  const visibleAdmin = adminItems.filter((item) => {
    if (item.url === "/archive" && ["DISPATCH", "ADMIN", "SUPER_ADMIN"].includes(upperRole)) return true;
    return can(role, item.resource);
  });

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : "?";

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <img src="/branding/logo-small.png" alt="UCM" className="h-9 w-auto flex-shrink-0" data-testid="img-sidebar-logo" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" data-testid="text-sidebar-title">UCM</p>
            <p className="text-xs text-muted-foreground truncate">Mobility System</p>
          </div>
        </div>

        {cities.length > 0 && (
          <div className="mt-3">
            <Select
              value={selectedCity?.id?.toString() || ""}
              onValueChange={(val) => {
                const city = cities.find((c) => c.id === parseInt(val));
                if (city) setSelectedCity(city);
              }}
            >
              <SelectTrigger className="w-full" data-testid="select-city">
                <SelectValue placeholder="Select city" />
              </SelectTrigger>
              <SelectContent>
                {cities.map((city) => (
                  <SelectItem key={city.id} value={city.id.toString()}>
                    {city.name}, {city.state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {visibleNav.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Operations</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNav.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                    >
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase()}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleAdmin.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleAdmin.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                    >
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(' ', '-')}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 flex-shrink-0">
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.role?.replace("_", " ")}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={logout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
