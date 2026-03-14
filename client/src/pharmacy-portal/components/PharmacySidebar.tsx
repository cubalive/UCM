import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  LayoutDashboard,
  Package,
  Truck,
  BarChart3,
  Settings,
  LogOut,
  Pill,
  X,
  Plus,
  Boxes,
  FileText,
  DollarSign,
  ShieldCheck,
} from "lucide-react";

interface PharmacySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
}

export function PharmacySidebar({ isOpen, onClose, currentPath }: PharmacySidebarProps) {
  const { logout } = useAuth();
  const { t } = useTranslation();

  const NAV_ITEMS = [
    { path: "/", label: t('pharmacy.sidebar.dashboard'), icon: LayoutDashboard },
    { path: "/orders", label: t('pharmacy.sidebar.orders'), icon: Package },
    { path: "/orders/new", label: t('pharmacy.sidebar.newOrder'), icon: Plus },
    { path: "/tracking", label: t('pharmacy.sidebar.tracking'), icon: Truck },
    { path: "/inventory", label: t('pharmacy.sidebar.inventory'), icon: Boxes },
    { path: "/prescriptions", label: t('pharmacy.sidebar.prescriptions'), icon: FileText },
    { path: "/billing", label: t('pharmacy.sidebar.billing'), icon: DollarSign },
    { path: "/metrics", label: t('pharmacy.sidebar.metrics'), icon: BarChart3 },
    { path: "/compliance", label: t('pharmacy.sidebar.compliance'), icon: ShieldCheck },
    { path: "/settings", label: t('pharmacy.sidebar.settings'), icon: Settings },
  ];

  return (
    <aside
      className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-64 bg-[#0f172a] border-r border-[#1e293b]
        transform transition-transform duration-200 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        flex flex-col
      `}
      aria-label={t('pharmacy.sidebar.label')}
    >
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-[#1e293b]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Pill className="w-4 h-4 text-white" aria-hidden="true" />
          </div>
          <div>
            <span className="text-sm font-bold text-white">UCM</span>
            <span className="text-xs text-purple-400 block leading-none">{t('pharmacy.title')}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="lg:hidden p-1 hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label={t('pharmacy.sidebar.closeSidebar')}
        >
          <X className="w-4 h-4 text-gray-400" aria-hidden="true" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto" aria-label={t('pharmacy.sidebar.navigation')}>
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.path === "/"
              ? currentPath === "/" || currentPath === ""
              : currentPath.startsWith(item.path);
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path}>
              <button
                onClick={onClose}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                  transition-all duration-150
                  ${isActive
                    ? "bg-violet-500/10 text-violet-400 font-medium border border-violet-500/20"
                    : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
                  }
                `}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
                {item.path === "/orders/new" && (
                  <span className="ml-auto w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] flex items-center justify-center font-bold" aria-hidden="true">
                    +
                  </span>
                )}
              </button>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-[#1e293b] p-3">
        <button
          onClick={() => logout()}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-red-400/5 w-full transition-colors"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          <span>{t('pharmacy.sidebar.signOut')}</span>
        </button>
      </div>
    </aside>
  );
}
