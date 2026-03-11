import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
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
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  CreditCard,
  ChevronRight,
  AlertTriangle,
  Heart,
  Handshake,
  ShoppingCart,
  Gavel,
  Star,
  Layers,
  TrendingDown,
  Ban,
  CheckSquare,
  Bell,
  Pill,
  Package,
} from "lucide-react";

interface NavItem {
  titleKey: string;
  url: string;
  icon: typeof LayoutDashboard;
  resource: Resource;
  superAdminOnly?: boolean;
}

interface NavGroup {
  labelKey: string;
  icon: typeof LayoutDashboard;
  items: NavItem[];
  defaultOpen?: boolean;
}

const operationGroups: NavGroup[] = [
  {
    labelKey: "nav.group.dispatch",
    icon: Radio,
    defaultOpen: true,
    items: [
      { titleKey: "nav.dashboard", url: "/", icon: LayoutDashboard, resource: "dashboard" },
      { titleKey: "nav.dispatch", url: "/dispatch", icon: Radio, resource: "dispatch" },
      { titleKey: "nav.dispatchBoard", url: "/dispatch-board", icon: ClipboardCheck, resource: "dispatch" },
      { titleKey: "nav.tripRequestsQueue", url: "/trip-requests-queue", icon: ClipboardCheck, resource: "dispatch" },
      { titleKey: "nav.liveMap", url: "/live-map", icon: Map, resource: "dispatch" },
    ],
  },
  {
    labelKey: "nav.group.fleet",
    icon: Car,
    items: [
      { titleKey: "nav.fleet", url: "/fleet", icon: Gauge, resource: "dispatch" },
      { titleKey: "nav.assignments", url: "/assignments", icon: CalendarCheck, resource: "dispatch" },
      { titleKey: "nav.schedule", url: "/schedule", icon: Calendar, resource: "dispatch" },
      { titleKey: "nav.shiftSwaps", url: "/dispatch-swaps", icon: ArrowLeftRight, resource: "dispatch" },
      { titleKey: "nav.deadMile", url: "/dead-mile", icon: TrendingDown, resource: "dispatch" },
      { titleKey: "nav.interCity", url: "/inter-city", icon: ArrowLeftRight, resource: "dispatch" },
    ],
  },
  {
    labelKey: "nav.group.automation",
    icon: Zap,
    items: [
      { titleKey: "nav.autoAssign", url: "/auto-assignment", icon: Zap, resource: "dispatch" },
      { titleKey: "nav.etaEscalations", url: "/eta-escalations", icon: AlertTriangle, resource: "dispatch" },
      { titleKey: "nav.cascadeAlerts", url: "/cascade-alerts", icon: Bell, resource: "dispatch" },
      { titleKey: "nav.smartCancel", url: "/smart-cancel", icon: Ban, resource: "dispatch" },
      { titleKey: "nav.tripGroups", url: "/trip-groups", icon: Layers, resource: "dispatch" },
      { titleKey: "nav.dialysisMode", url: "/zero-touch-dialysis", icon: Heart, resource: "dispatch" },
      { titleKey: "nav.opsHealth", url: "/ops-health", icon: Activity, resource: "dispatch" },
      { titleKey: "nav.opsChecks", url: "/ops-checks", icon: ShieldCheck, resource: "dispatch" },
    ],
  },
  {
    labelKey: "nav.group.tripsPatients",
    icon: Route,
    items: [
      { titleKey: "nav.trips", url: "/trips", icon: Route, resource: "trips" },
      { titleKey: "nav.patients", url: "/patients", icon: HeartPulse, resource: "patients" },
    ],
  },
  {
    labelKey: "nav.group.resources",
    icon: Users,
    items: [
      { titleKey: "nav.drivers", url: "/drivers", icon: UserCheck, resource: "drivers" },
      { titleKey: "nav.vehicles", url: "/vehicles", icon: Truck, resource: "vehicles" },
      { titleKey: "nav.clinics", url: "/clinics", icon: Building2, resource: "clinics" },
    ],
  },
  {
    labelKey: "nav.group.billing",
    icon: CreditCard,
    items: [
      { titleKey: "nav.invoices", url: "/invoices", icon: FileText, resource: "invoices" },
      { titleKey: "nav.billing", url: "/billing", icon: Receipt, resource: "invoices" },
      { titleKey: "nav.clinicBilling", url: "/clinic-billing", icon: DollarSign, resource: "invoices" },
      { titleKey: "nav.timecards", url: "/timecards", icon: Clock, resource: "time_entries" },
      { titleKey: "nav.tpPayroll", url: "/tp-payroll", icon: Banknote, resource: "payroll" },
      { titleKey: "nav.payrollSettings", url: "/payroll-settings", icon: Settings2, resource: "payroll" },
      { titleKey: "nav.billingConfig", url: "/billing-config", icon: Settings2, resource: "billing" },
      { titleKey: "nav.platformFees", url: "/platform-fees", icon: DollarSign, resource: "billing", superAdminOnly: true },
      { titleKey: "nav.feeRules", url: "/fee-rules", icon: Settings2, resource: "billing", superAdminOnly: true },
      { titleKey: "nav.medicaidBilling", url: "/medicaid-billing", icon: FileText, resource: "billing", superAdminOnly: true },
      { titleKey: "nav.ediBilling", url: "/edi-billing", icon: FileText, resource: "billing", superAdminOnly: true },
      { titleKey: "nav.reconciliation", url: "/reconciliation", icon: CheckSquare, resource: "billing", superAdminOnly: true },
      { titleKey: "nav.clinicBillingV2", url: "/clinic-billing-v2", icon: Receipt, resource: "billing" },
    ],
  },
  {
    labelKey: "nav.group.support",
    icon: MessageSquare,
    items: [
      { titleKey: "nav.supportChat", url: "/support-chat", icon: MessageSquare, resource: "support" },
    ],
  },
];

const adminGroups: NavGroup[] = [
  {
    labelKey: "nav.group.management",
    icon: Users,
    defaultOpen: true,
    items: [
      { titleKey: "nav.cities", url: "/cities", icon: MapPin, resource: "cities" },
      { titleKey: "nav.users", url: "/users", icon: Users, resource: "users" },
      { titleKey: "nav.companies", url: "/companies", icon: Building, resource: "audit", superAdminOnly: true },
    ],
  },
  {
    labelKey: "nav.group.analytics",
    icon: BarChart3,
    items: [
      { titleKey: "nav.reports", url: "/reports", icon: BarChart3, resource: "audit" },
      { titleKey: "nav.financial", url: "/financial", icon: DollarSign, resource: "audit" },
      { titleKey: "nav.pricing", url: "/pricing", icon: Banknote, resource: "audit" },
      { titleKey: "nav.ratings", url: "/ratings", icon: Star, resource: "audit" },
      { titleKey: "nav.cityComparison", url: "/city-comparison", icon: BarChart, resource: "audit", superAdminOnly: true },
      { titleKey: "nav.metrics", url: "/metrics", icon: BarChart, resource: "audit", superAdminOnly: true },
    ],
  },
  {
    labelKey: "nav.group.audit",
    icon: ClipboardList,
    items: [
      { titleKey: "nav.auditLog", url: "/audit", icon: ClipboardList, resource: "audit" },
      { titleKey: "nav.archive", url: "/archive", icon: Archive, resource: "audit" },
      { titleKey: "nav.auditShield", url: "/audit-shield", icon: Shield, resource: "audit", superAdminOnly: true },
    ],
  },
  {
    labelKey: "nav.group.intelligence",
    icon: Brain,
    items: [
      { titleKey: "nav.intelligence", url: "/intelligence", icon: Brain, resource: "audit" },
      { titleKey: "nav.indexes", url: "/indexes", icon: Activity, resource: "audit", superAdminOnly: true },
      { titleKey: "nav.certification", url: "/certification", icon: Award, resource: "audit", superAdminOnly: true },
      { titleKey: "nav.ranking", url: "/ranking", icon: Trophy, resource: "audit", superAdminOnly: true },
      { titleKey: "nav.prediction", url: "/prediction", icon: TrendingUp, resource: "audit", superAdminOnly: true },
      { titleKey: "nav.aiDashboard", url: "/ai-dashboard", icon: Brain, resource: "audit", superAdminOnly: true },
    ],
  },
  {
    labelKey: "nav.group.broker",
    icon: Gavel,
    items: [
      { titleKey: "nav.brokers", url: "/admin/brokers", icon: Handshake, resource: "broker_marketplace", superAdminOnly: true },
      { titleKey: "nav.marketplace", url: "/marketplace", icon: ShoppingCart, resource: "broker_marketplace" },
    ],
  },
  {
    labelKey: "nav.group.pharmacy",
    icon: Pill,
    items: [
      { titleKey: "nav.pharmacies", url: "/admin/pharmacies", icon: Pill, resource: "audit", superAdminOnly: true },
      { titleKey: "nav.pharmacyOrders", url: "/admin/pharmacy-orders", icon: Package, resource: "audit", superAdminOnly: true },
    ],
  },
  {
    labelKey: "nav.group.system",
    icon: Gauge,
    items: [
      { titleKey: "nav.publishCenter", url: "/publish-center", icon: Send, resource: "audit", superAdminOnly: true },
      { titleKey: "nav.dataImport", url: "/admin/imports", icon: Upload, resource: "audit", superAdminOnly: true },
      { titleKey: "nav.systemStatus", url: "/system-status", icon: Gauge, resource: "audit", superAdminOnly: true },
    ],
  },
];

const STORAGE_KEY = "ucm-sidebar-groups";

function loadGroupState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveGroupState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function CollapsibleNavGroup({
  group,
  location,
  role,
  t,
  openState,
  onToggle,
}: {
  group: NavGroup;
  location: string;
  role: string;
  t: (key: string) => string;
  openState: boolean;
  onToggle: (open: boolean) => void;
}) {
  const upperRole = role.toUpperCase();
  const visibleItems = group.items.filter((item) => {
    if (item.superAdminOnly && upperRole !== "SUPER_ADMIN") return false;
    if (item.url === "/live-map" && ["VIEWER", "DRIVER"].includes(upperRole)) return true;
    if (item.url === "/archive" && ["DISPATCH", "ADMIN", "COMPANY_ADMIN", "SUPER_ADMIN"].includes(upperRole)) return true;
    return can(role, item.resource);
  });

  if (visibleItems.length === 0) return null;

  const hasActiveItem = visibleItems.some((item) =>
    item.url === "/" ? location === "/" : location.startsWith(item.url)
  );
  const GroupIcon = group.icon;

  return (
    <Collapsible open={openState} onOpenChange={onToggle} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={hasActiveItem}
            className="font-medium transition-all duration-200"
            data-testid={`btn-group-${group.labelKey}`}
          >
            <GroupIcon className="w-4 h-4" />
            <span className="flex-1">{t(group.labelKey)}</span>
            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${openState ? "rotate-90" : ""}`} />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="transition-all duration-200 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <SidebarMenuSub>
            {visibleItems.map((item) => {
              const isActive = item.url === "/" ? location === "/" : location.startsWith(item.url);
              return (
                <SidebarMenuSubItem key={item.titleKey}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={isActive}
                    className="transition-all duration-150"
                  >
                    <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, '') || 'dashboard'}`}>
                      <item.icon className="w-3.5 h-3.5" />
                      <span>{t(item.titleKey)}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, cities, selectedCity, setSelectedCity, logout } = useAuth();
  const { t } = useTranslation();

  const versionQuery = useQuery<{ version?: string }>({
    queryKey: ["/version.json"],
    queryFn: async () => {
      const res = await fetch("/version.json?_t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 300_000,
  });

  const role = user?.role || "";
  const upperRole = role.toUpperCase();
  const isDriver = upperRole === "DRIVER";
  const isClinic = !!user?.clinicId;
  const CLINIC_SCOPED = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"];

  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() => {
    const saved = loadGroupState();
    const defaults: Record<string, boolean> = {};
    [...operationGroups, ...adminGroups].forEach((g) => {
      defaults[g.labelKey] = saved[g.labelKey] ?? (g.defaultOpen || false);
    });
    return defaults;
  });

  useEffect(() => {
    const allGroups = [...operationGroups, ...adminGroups];
    const matchingGroup = allGroups.find((g) =>
      g.items.some((item) =>
        item.url === "/" ? location === "/" : location.startsWith(item.url)
      )
    );
    if (matchingGroup && !groupOpen[matchingGroup.labelKey]) {
      setGroupOpen((prev) => {
        const next = { ...prev, [matchingGroup.labelKey]: true };
        saveGroupState(next);
        return next;
      });
    }
  }, [location]);

  const toggleGroup = (key: string) => (open: boolean) => {
    setGroupOpen((prev) => {
      const next = { ...prev, [key]: open };
      saveGroupState(next);
      return next;
    });
  };

  const driverNavItems: NavItem[] = [
    { titleKey: "nav.myTrips", url: "/driver", icon: Car, resource: "trips" },
    { titleKey: "nav.tripHistory", url: "/driver/history", icon: History, resource: "trips" },
  ];

  const clinicNavItems: NavItem[] = [
    { titleKey: "nav.clinicPortal", url: "/clinic-trips", icon: Stethoscope, resource: "trips" },
    { titleKey: "nav.invoices", url: "/invoices", icon: FileText, resource: "invoices" },
    { titleKey: "nav.clinicBillingV2", url: "/clinic-billing-v2", icon: Receipt, resource: "billing" },
    { titleKey: "nav.supportChat", url: "/support-chat", icon: MessageSquare, resource: "support" },
    ...(upperRole === "CLINIC_ADMIN" ? [{ titleKey: "nav.clinicUsers" as const, url: "/clinic-users", icon: Users, resource: "users" as Resource }] : []),
  ];

  const showSimpleNav = isDriver || (isClinic && (CLINIC_SCOPED.includes(upperRole) || upperRole === "VIEWER"));
  const simpleItems = isDriver ? driverNavItems : clinicNavItems;

  const hasVisibleAdmin = !isDriver && adminGroups.some((g) =>
    g.items.some((item) => {
      if (item.superAdminOnly && upperRole !== "SUPER_ADMIN") return false;
      if (item.url === "/archive" && ["DISPATCH", "ADMIN", "COMPANY_ADMIN", "SUPER_ADMIN"].includes(upperRole)) return true;
      return can(role, item.resource);
    })
  );

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : "?";

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          {user?.companyId ? (
            <img
              src={`/api/companies/${user.companyId}/logo`}
              alt="Company"
              className="h-9 w-9 rounded-full object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).src = "/branding/logo-small.png"; }}
              data-testid="img-sidebar-logo"
            />
          ) : (
            <div className="h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg" data-testid="img-sidebar-logo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" fill="white" fillOpacity="0.9"/>
                <path d="M10 15l-3-3 1.41-1.41L10 12.17l5.59-5.59L17 8l-7 7z" fill="currentColor" className="text-emerald-600"/>
              </svg>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-wide truncate" data-testid="text-sidebar-title">
              {(user as any)?.companyName ? (
                <span className="text-sidebar-foreground">{(user as any).companyName}</span>
              ) : (
                <>
                  <span className="text-sidebar-foreground">UCM</span>
                  <span className="text-[hsl(var(--gold))] ml-1 text-[10px] font-semibold tracking-widest uppercase">Elite</span>
                </>
              )}
            </p>
            <p className="text-[11px] text-sidebar-foreground/50 truncate tracking-wide">
              {(user as any)?.brandTagline || t("nav.mobilitySystem")}
            </p>
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
                {Object.entries(
                  cities.reduce<Record<string, typeof cities>>((acc, city) => {
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
                        <SelectItem key={city.id} value={city.id.toString()}>
                          {city.name}, {city.state}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {showSimpleNav ? (
          <SidebarGroup>
            <SidebarGroupLabel>{t("nav.operations")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {simpleItems.map((item) => {
                  const isActive = item.url === "/" ? location === "/" : location.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.titleKey}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className="transition-all duration-150"
                      >
                        <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, '') || 'dashboard'}`}>
                          <item.icon className="w-4 h-4" />
                          <span>{t(item.titleKey)}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground/60 px-3">
                {t("nav.operations")}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {operationGroups.map((group) => (
                    <CollapsibleNavGroup
                      key={group.labelKey}
                      group={group}
                      location={location}
                      role={role}
                      t={t}
                      openState={groupOpen[group.labelKey] ?? false}
                      onToggle={toggleGroup(group.labelKey)}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {hasVisibleAdmin && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground/60 px-3">
                  {t("nav.administration")}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {adminGroups.map((group) => (
                      <CollapsibleNavGroup
                        key={group.labelKey}
                        group={group}
                        location={location}
                        role={role}
                        t={t}
                        openState={groupOpen[group.labelKey] ?? false}
                        onToggle={toggleGroup(group.labelKey)}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 flex-shrink-0">
            <AvatarFallback className="text-xs bg-gradient-to-br from-emerald-500 to-emerald-700 text-white font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[11px] text-sidebar-foreground/50 truncate uppercase tracking-wider">
              {user?.role?.replace("_", " ")}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={logout}
            className="transition-colors duration-150 hover:text-destructive"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-sidebar-foreground/40 text-center mt-1 tracking-wider" data-testid="text-admin-version">
          UCM v{versionQuery.data?.version || "..."}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
