import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  FileText,
  Handshake,
  DollarSign,
  BarChart3,
  User,
  LogOut,
  ShoppingCart,
  Gavel,
  Shield,
  ClipboardCheck,
  MessageSquare,
  Scale,
  Navigation,
  Settings,
} from "lucide-react";

interface BrokerSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
}

const NAV_ITEMS = [
  { path: "/", labelKey: "broker.sidebar.dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { path: "/trip-requests", labelKey: "broker.sidebar.tripRequests", icon: FileText, testId: "nav-trip-requests" },
  { path: "/live-tracking", labelKey: "broker.sidebar.liveTracking", icon: Navigation, testId: "nav-live-tracking" },
  { path: "/marketplace", labelKey: "broker.sidebar.marketplace", icon: ShoppingCart, testId: "nav-marketplace" },
  { path: "/contracts", labelKey: "broker.sidebar.contracts", icon: Handshake, testId: "nav-contracts" },
  { path: "/settlements", labelKey: "broker.sidebar.settlements", icon: DollarSign, testId: "nav-settlements" },
  { path: "/sla-monitoring", labelKey: "broker.sidebar.slaMonitoring", icon: Shield, testId: "nav-sla-monitoring" },
  { path: "/disputes", labelKey: "broker.sidebar.disputes", icon: Scale, testId: "nav-disputes" },
  { path: "/compliance", labelKey: "broker.sidebar.compliance", icon: ClipboardCheck, testId: "nav-compliance" },
  { path: "/communications", labelKey: "broker.sidebar.communications", icon: MessageSquare, testId: "nav-communications" },
  { path: "/analytics", labelKey: "broker.sidebar.analytics", icon: BarChart3, testId: "nav-analytics" },
  { path: "/settings", labelKey: "broker.sidebar.settings", icon: Settings, testId: "nav-settings" },
  { path: "/profile", labelKey: "broker.sidebar.profile", icon: User, testId: "nav-profile" },
];

export function BrokerSidebar({ isOpen, onClose, currentPath }: BrokerSidebarProps) {
  const { logout } = useAuth();
  const { t } = useTranslation();

  return (
    <aside
      className={`
        fixed lg:relative inset-y-0 left-0 z-40
        w-64 bg-[#0f172a] border-r border-[#1e293b]
        flex flex-col
        transition-transform duration-200 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}
      data-testid="broker-sidebar"
      aria-label={t("broker.sidebar.navigation")}
    >
      <div className="p-4 border-b border-[#1e293b]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-400 rounded-full flex items-center justify-center">
            <Gavel className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">{t("broker.unitedCare")}</h2>
            <p className="text-[10px] text-blue-400 uppercase tracking-wider">{t("broker.sidebar.brokerPortal")}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto" data-testid="broker-nav" aria-label={t("broker.sidebar.navigation")}>
        {NAV_ITEMS.map(({ path, labelKey, icon: Icon, testId }) => {
          const isActive = currentPath === path || (path !== "/" && currentPath.startsWith(path));
          return (
            <Link key={path} href={path}>
              <button
                onClick={onClose}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all
                  ${isActive
                    ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                    : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
                  }
                `}
                data-testid={testId}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {t(labelKey)}
              </button>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-[#1e293b]">
        <button
          onClick={() => logout()}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          {t("broker.signOut")}
        </button>
      </div>
    </aside>
  );
}
