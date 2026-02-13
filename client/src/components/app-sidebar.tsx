import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
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
} from "lucide-react";
import logoImg from "@assets/public:logo-master.png_1770964647689.PNG";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Dispatch", url: "/dispatch", icon: Radio },
  { title: "Trips", url: "/trips", icon: Route },
  { title: "Patients", url: "/patients", icon: HeartPulse },
  { title: "Drivers", url: "/drivers", icon: UserCheck },
  { title: "Vehicles", url: "/vehicles", icon: Truck },
  { title: "Clinics", url: "/clinics", icon: Building2 },
];

const adminItems = [
  { title: "Cities", url: "/cities", icon: MapPin },
  { title: "Users", url: "/users", icon: Users },
  { title: "Audit Log", url: "/audit", icon: ClipboardList },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, cities, selectedCity, setSelectedCity, logout, isSuperAdmin } = useAuth();

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : "?";

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <img src={logoImg} alt="UCM" className="h-9 w-auto flex-shrink-0" data-testid="img-sidebar-logo" />
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
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
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

        {(isSuperAdmin || user?.role === "ADMIN") && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
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
