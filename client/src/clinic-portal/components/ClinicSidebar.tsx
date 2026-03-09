import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard,
  Car,
  MapPin,
  CreditCard,
  User,
  LogOut,
  Activity,
  ClipboardList,
} from "lucide-react";

interface ClinicSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
}

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { path: "/requests", label: "Trip Requests", icon: ClipboardList, testId: "nav-requests" },
  { path: "/trips", label: "Trips", icon: Car, testId: "nav-trips" },
  { path: "/live", label: "Live View", icon: MapPin, testId: "nav-live" },
  { path: "/billing", label: "Billing", icon: CreditCard, testId: "nav-billing" },
  { path: "/profile", label: "Profile", icon: User, testId: "nav-profile" },
];

export function ClinicSidebar({ isOpen, onClose, currentPath }: ClinicSidebarProps) {
  const { logout } = useAuth();

  return (
    <aside
      className={`
        fixed lg:relative inset-y-0 left-0 z-40
        w-64 bg-[#0f172a] border-r border-[#1e293b]
        flex flex-col
        transition-transform duration-200 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}
      data-testid="clinic-sidebar"
    >
      <div className="p-4 border-b border-[#1e293b]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-400 rounded-full flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">United Care</h2>
            <p className="text-[10px] text-emerald-400 uppercase tracking-wider">Clinic Portal</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1" data-testid="clinic-nav">
        {NAV_ITEMS.map(({ path, label, icon: Icon, testId }) => {
          const isActive = currentPath === path || (path !== "/" && currentPath.startsWith(path));
          return (
            <Link key={path} href={path}>
              <button
                onClick={onClose}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                  ${isActive
                    ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                    : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
                  }
                `}
                data-testid={testId}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
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
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
