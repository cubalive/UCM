import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  LayoutDashboard, MapPin, Users, Truck, Route, Radio, Clock, UserCheck, Building2, HeartPulse,
  FileText, Gauge, Map, Calendar, BarChart3, DollarSign, Brain, Receipt, Settings2, MessageSquare,
  Pill, Package, Handshake, ShoppingCart, Shield, Activity, Zap, Star, Upload, Bell, Banknote,
  Car, ClipboardCheck, Archive, Award, Trophy, TrendingUp, Send, Heart, ArrowLeftRight,
  TrendingDown, Ban, Layers, CheckSquare, CreditCard, Building, Search
} from "lucide-react";

interface PageEntry {
  title: string;
  url: string;
  icon: any;
  group: string;
  keywords?: string;
}

const ALL_PAGES: PageEntry[] = [
  // Dispatch & Operations
  { title: "Dashboard", url: "/", icon: LayoutDashboard, group: "Dispatch", keywords: "home main overview" },
  { title: "Dispatch Map", url: "/dispatch", icon: Radio, group: "Dispatch", keywords: "dispatch map realtime" },
  { title: "Dispatch Board", url: "/dispatch-board", icon: ClipboardCheck, group: "Dispatch", keywords: "dispatch board assign" },
  { title: "Trip Requests Queue", url: "/trip-requests-queue", icon: ClipboardCheck, group: "Dispatch", keywords: "trip requests queue" },
  { title: "Live Map", url: "/live-map", icon: Map, group: "Dispatch", keywords: "live map tracking" },
  // Fleet
  { title: "Fleet Ops", url: "/fleet", icon: Gauge, group: "Fleet", keywords: "fleet operations" },
  { title: "Assignments", url: "/assignments", icon: Calendar, group: "Fleet", keywords: "assignments driver vehicle" },
  { title: "Schedule", url: "/schedule", icon: Calendar, group: "Fleet", keywords: "schedule shift" },
  { title: "Shift Swaps", url: "/dispatch-swaps", icon: ArrowLeftRight, group: "Fleet", keywords: "shift swap exchange" },
  { title: "Dead Mile Tracking", url: "/dead-mile", icon: TrendingDown, group: "Fleet", keywords: "dead mile empty" },
  { title: "Inter-City Transfers", url: "/inter-city", icon: ArrowLeftRight, group: "Fleet", keywords: "inter city transfer" },
  // Automation
  { title: "Auto Assignment", url: "/auto-assignment", icon: Zap, group: "Automation", keywords: "auto assign automatic" },
  { title: "ETA Escalations", url: "/eta-escalations", icon: Bell, group: "Automation", keywords: "eta escalation late" },
  { title: "Cascade Alerts", url: "/cascade-alerts", icon: Bell, group: "Automation", keywords: "cascade alert delay" },
  { title: "Smart Cancel", url: "/smart-cancel", icon: Ban, group: "Automation", keywords: "smart cancel cancellation" },
  { title: "Trip Groups", url: "/trip-groups", icon: Layers, group: "Automation", keywords: "trip group batch" },
  { title: "Dialysis Mode", url: "/zero-touch-dialysis", icon: Heart, group: "Automation", keywords: "dialysis zero touch" },
  { title: "Ops Health", url: "/ops-health", icon: Activity, group: "Automation", keywords: "ops health monitor" },
  // Trips & Patients
  { title: "Trips", url: "/trips", icon: Route, group: "Trips & Patients", keywords: "trip ride transport" },
  { title: "Patients", url: "/patients", icon: HeartPulse, group: "Trips & Patients", keywords: "patient member rider" },
  // Resources
  { title: "Drivers", url: "/drivers", icon: UserCheck, group: "Resources", keywords: "driver employee" },
  { title: "Vehicles", url: "/vehicles", icon: Truck, group: "Resources", keywords: "vehicle car van" },
  { title: "Clinics", url: "/clinics", icon: Building2, group: "Resources", keywords: "clinic facility medical" },
  // Billing
  { title: "Invoices", url: "/invoices", icon: FileText, group: "Billing", keywords: "invoice bill payment" },
  { title: "Billing", url: "/billing", icon: Receipt, group: "Billing", keywords: "billing charge" },
  { title: "Clinic Billing", url: "/clinic-billing", icon: DollarSign, group: "Billing", keywords: "clinic billing" },
  { title: "Timecards", url: "/timecards", icon: Clock, group: "Billing", keywords: "timecard hours" },
  { title: "Payroll", url: "/tp-payroll", icon: Banknote, group: "Billing", keywords: "payroll salary" },
  { title: "Platform Fees", url: "/platform-fees", icon: DollarSign, group: "Billing", keywords: "platform fee subscription" },
  { title: "Fee Rules", url: "/fee-rules", icon: Settings2, group: "Billing", keywords: "fee rules pricing" },
  { title: "Medicaid Billing", url: "/medicaid-billing", icon: FileText, group: "Billing", keywords: "medicaid insurance claim" },
  { title: "EDI Billing", url: "/edi-billing", icon: FileText, group: "Billing", keywords: "edi 837 835 claim" },
  { title: "Reconciliation", url: "/reconciliation", icon: CheckSquare, group: "Billing", keywords: "reconciliation match" },
  // Admin
  { title: "Cities", url: "/cities", icon: MapPin, group: "Admin", keywords: "city location" },
  { title: "Users", url: "/users", icon: Users, group: "Admin", keywords: "user account role" },
  { title: "Companies", url: "/companies", icon: Building, group: "Admin", keywords: "company tenant" },
  // Analytics
  { title: "Reports", url: "/reports", icon: BarChart3, group: "Analytics", keywords: "report analytics" },
  { title: "Ratings", url: "/ratings", icon: Star, group: "Analytics", keywords: "rating review" },
  { title: "City Comparison", url: "/city-comparison", icon: BarChart3, group: "Analytics", keywords: "city comparison" },
  { title: "Metrics", url: "/metrics", icon: BarChart3, group: "Analytics", keywords: "metrics kpi" },
  // Intelligence
  { title: "Intelligence", url: "/intelligence", icon: Brain, group: "Intelligence", keywords: "intelligence insights" },
  { title: "AI Dashboard", url: "/ai-dashboard", icon: Brain, group: "Intelligence", keywords: "ai dashboard prediction" },
  { title: "Prediction", url: "/prediction", icon: TrendingUp, group: "Intelligence", keywords: "prediction forecast" },
  // Broker & Pharmacy
  { title: "Brokers", url: "/admin/brokers", icon: Handshake, group: "Broker & Pharmacy", keywords: "broker payer" },
  { title: "Marketplace", url: "/marketplace", icon: ShoppingCart, group: "Broker & Pharmacy", keywords: "marketplace bid" },
  { title: "Pharmacies", url: "/admin/pharmacies", icon: Pill, group: "Broker & Pharmacy", keywords: "pharmacy rx" },
  { title: "Pharmacy Orders", url: "/admin/pharmacy-orders", icon: Package, group: "Broker & Pharmacy", keywords: "pharmacy order delivery" },
  // System
  { title: "Audit Log", url: "/audit", icon: FileText, group: "System", keywords: "audit log" },
  { title: "System Status", url: "/system-status", icon: Gauge, group: "System", keywords: "system status health" },
  { title: "Data Import", url: "/admin/imports", icon: Upload, group: "System", keywords: "import csv upload" },
  { title: "Support Chat", url: "/support-chat", icon: MessageSquare, group: "System", keywords: "support chat help" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleSelect = useCallback((url: string) => {
    setOpen(false);
    navigate(url);
  }, [navigate]);

  // Group pages
  const grouped = ALL_PAGES.reduce<Record<string, PageEntry[]>>((acc, page) => {
    if (!acc[page.group]) acc[page.group] = [];
    acc[page.group].push(page);
    return acc;
  }, {});

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground rounded-lg border border-border/50 hover:bg-accent/50 transition-colors"
        data-testid="btn-command-palette"
      >
        <Search className="w-3.5 h-3.5" />
        <span>Search...</span>
        <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          <span className="text-[10px]">⌘</span>K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages, features..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {Object.entries(grouped).map(([group, pages]) => (
            <CommandGroup key={group} heading={group}>
              {pages.map((page) => (
                <CommandItem
                  key={page.url}
                  value={`${page.title} ${page.keywords || ""}`}
                  onSelect={() => handleSelect(page.url)}
                >
                  <page.icon className="mr-2 h-4 w-4" />
                  <span>{page.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
