import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { can, type Resource } from "@shared/permissions";
import { useTranslation } from "react-i18next";
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
  Clock,
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
  Calendar,
  CalendarCheck,
  BarChart3,
  Activity,
  DollarSign,
  Zap,
  Car,
  History,
  ClipboardCheck,
  Stethoscope,
  Receipt,
  ShieldCheck,
  Banknote,
  BarChart,
  ArrowLeftRight,
  Brain,
  Award,
  Trophy,
  Shield,
  TrendingUp,
  Send,
  Upload,
  Building,
  MessageSquare,
  Settings2,
} from "lucide-react";

interface NavItem {
  titleKey: string;
  url: string;
  icon: typeof LayoutDashboard;
  resource: Resource;
  superAdminOnly?: boolean;
}

const navItems: NavItem[] = [
  { titleKey: "nav.dashboard", url: "/", icon: LayoutDashboard, resource: "dashboard" },
  { titleKey: "nav.dispatch", url: "/dispatch", icon: Radio, resource: "dispatch" },
  { titleKey: "nav.fleet", url: "/fleet", icon: Gauge, resource: "dispatch" },
  { titleKey: "nav.assignments", url: "/assignments", icon: CalendarCheck, resource: "dispatch" },
  { titleKey: "nav.liveMap", url: "/live-map", icon: Map, resource: "dispatch" },
  { titleKey: "nav.trips", url: "/trips", icon: Route, resource: "trips" },
  { titleKey: "nav.patients", url: "/patients", icon: HeartPulse, resource: "patients" },
  { titleKey: "nav.drivers", url: "/drivers", icon: UserCheck, resource: "drivers" },
  { titleKey: "nav.vehicles", url: "/vehicles", icon: Truck, resource: "vehicles" },
  { titleKey: "nav.clinics", url: "/clinics", icon: Building2, resource: "clinics" },
  { titleKey: "nav.invoices", url: "/invoices", icon: FileText, resource: "invoices" },
  { titleKey: "nav.billing", url: "/billing", icon: Receipt, resource: "invoices" },
  { titleKey: "nav.clinicBilling", url: "/clinic-billing", icon: DollarSign, resource: "invoices" },
  { titleKey: "nav.dispatchBoard", url: "/dispatch-board", icon: ClipboardCheck, resource: "dispatch" },
  { titleKey: "nav.opsHealth", url: "/ops-health", icon: Activity, resource: "dispatch" },
  { titleKey: "nav.opsChecks", url: "/ops-checks", icon: ShieldCheck, resource: "dispatch" },
  { titleKey: "nav.autoAssign", url: "/auto-assignment", icon: Zap, resource: "dispatch" },
  { titleKey: "nav.schedule", url: "/schedule", icon: Calendar, resource: "dispatch" },
  { titleKey: "nav.shiftSwaps", url: "/dispatch-swaps", icon: ArrowLeftRight, resource: "dispatch" },
  { titleKey: "nav.timecards", url: "/timecards", icon: Clock, resource: "time_entries" },
  { titleKey: "nav.tpPayroll", url: "/tp-payroll", icon: Banknote, resource: "payroll" },
  { titleKey: "nav.billingConfig", url: "/billing-config", icon: Settings2, resource: "billing" },
  { titleKey: "nav.clinicBillingV2", url: "/clinic-billing-v2", icon: Receipt, resource: "billing" },
  { titleKey: "nav.supportChat", url: "/support-chat", icon: MessageSquare, resource: "support" },
];

const adminItems: NavItem[] = [
  { titleKey: "nav.cities", url: "/cities", icon: MapPin, resource: "cities" },
  { titleKey: "nav.users", url: "/users", icon: Users, resource: "users" },
  { titleKey: "nav.reports", url: "/reports", icon: BarChart3, resource: "audit" },
  { titleKey: "nav.financial", url: "/financial", icon: DollarSign, resource: "audit" },
  { titleKey: "nav.pricing", url: "/pricing", icon: Banknote, resource: "audit" },
  { titleKey: "nav.auditLog", url: "/audit", icon: ClipboardList, resource: "audit" },
  { titleKey: "nav.archive", url: "/archive", icon: Archive, resource: "audit" },
  { titleKey: "nav.intelligence", url: "/intelligence", icon: Brain, resource: "audit" },
  { titleKey: "nav.indexes", url: "/indexes", icon: Activity, resource: "audit", superAdminOnly: true },
  { titleKey: "nav.certification", url: "/certification", icon: Award, resource: "audit", superAdminOnly: true },
  { titleKey: "nav.ranking", url: "/ranking", icon: Trophy, resource: "audit", superAdminOnly: true },
  { titleKey: "nav.auditShield", url: "/audit-shield", icon: Shield, resource: "audit", superAdminOnly: true },
  { titleKey: "nav.prediction", url: "/prediction", icon: TrendingUp, resource: "audit", superAdminOnly: true },
  { titleKey: "nav.publishCenter", url: "/publish-center", icon: Send, resource: "audit", superAdminOnly: true },
  { titleKey: "nav.dataImport", url: "/admin/imports", icon: Upload, resource: "audit", superAdminOnly: true },
  { titleKey: "nav.companies", url: "/companies", icon: Building, resource: "audit", superAdminOnly: true },
  { titleKey: "nav.metrics", url: "/metrics", icon: BarChart, resource: "audit", superAdminOnly: true },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, cities, selectedCity, setSelectedCity, logout } = useAuth();
  const { t } = useTranslation();

  const role = user?.role || "";

  const upperRole = role.toUpperCase();
  const isDriver = upperRole === "DRIVER";

  const driverNavItems: NavItem[] = [
    { titleKey: "nav.myTrips", url: "/driver", icon: Car, resource: "trips" },
    { titleKey: "nav.tripHistory", url: "/driver/history", icon: History, resource: "trips" },
  ];

  const isClinic = !!user?.clinicId;

  const clinicNavItems: NavItem[] = [
    { titleKey: "nav.clinicPortal", url: "/clinic-trips", icon: Stethoscope, resource: "trips" },
    { titleKey: "nav.invoices", url: "/invoices", icon: FileText, resource: "invoices" },
  ];

  const visibleNav = isDriver
    ? driverNavItems
    : isClinic && upperRole === "VIEWER"
    ? clinicNavItems
    : navItems.filter((item) => {
        if (item.url === "/live-map" && ["VIEWER", "DRIVER"].includes(upperRole)) return true;
        return can(role, item.resource);
      });
  const visibleAdmin = isDriver
    ? []
    : adminItems.filter((item) => {
        if (item.superAdminOnly && upperRole !== "SUPER_ADMIN") return false;
        if (item.url === "/archive" && ["DISPATCH", "ADMIN", "COMPANY_ADMIN", "SUPER_ADMIN"].includes(upperRole)) return true;
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
            <p className="text-xs text-muted-foreground truncate">{t("nav.mobilitySystem")}</p>
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
            <SidebarGroupLabel>{t("nav.operations")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNav.map((item) => (
                  <SidebarMenuItem key={item.titleKey}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                    >
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, '') || 'dashboard'}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{t(item.titleKey)}</span>
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
            <SidebarGroupLabel>{t("nav.administration")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleAdmin.map((item) => (
                  <SidebarMenuItem key={item.titleKey}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                    >
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, '')}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{t(item.titleKey)}</span>
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
