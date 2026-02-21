import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import {
  Car,
  Clock,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  MapPin,
  CreditCard,
  ArrowRight,
  Users,
  CalendarDays,
} from "lucide-react";

export default function ClinicDashboard() {
  const { user } = useAuth();

  const { data: ops, isLoading: opsLoading } = useQuery({
    queryKey: ["/api/clinic/ops"],
    enabled: !!user?.clinicId,
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ["/api/clinic/metrics"],
    enabled: !!user?.clinicId,
  });

  const { data: activeTrips, isLoading: activeLoading } = useQuery({
    queryKey: ["/api/clinic/active-trips"],
    enabled: !!user?.clinicId,
  });

  const todayTrips = (ops as any)?.todayTrips ?? 0;
  const activeCount = Array.isArray(activeTrips) ? activeTrips.length : 0;
  const completedToday = (ops as any)?.completedToday ?? 0;
  const cancelledToday = (ops as any)?.cancelledToday ?? 0;
  const totalPatients = (metrics as any)?.totalPatients ?? 0;
  const avgRating = (metrics as any)?.avgRating ?? 0;

  const statCards = [
    { label: "Today's Trips", value: todayTrips, icon: CalendarDays, color: "blue", testId: "stat-today-trips" },
    { label: "Active Now", value: activeCount, icon: Car, color: "green", testId: "stat-active" },
    { label: "Completed", value: completedToday, icon: CheckCircle2, color: "emerald", testId: "stat-completed" },
    { label: "Cancelled", value: cancelledToday, icon: AlertTriangle, color: "amber", testId: "stat-cancelled" },
  ];

  const quickActions = [
    { label: "View All Trips", href: "/trips", icon: Car, testId: "action-trips" },
    { label: "Live Tracking", href: "/live", icon: MapPin, testId: "action-live" },
    { label: "Billing & Invoices", href: "/billing", icon: CreditCard, testId: "action-billing" },
  ];

  const loading = opsLoading || metricsLoading || activeLoading;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="clinic-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" data-testid="text-welcome">
            Welcome back
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Here's your clinic overview for today
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Clock className="w-3.5 h-3.5" />
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="stats-grid">
        {statCards.map((stat) => (
          <div
            key={stat.testId}
            className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 hover:border-blue-500/30 transition-colors"
            data-testid={stat.testId}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500 uppercase tracking-wider">{stat.label}</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-${stat.color}-500/10`}>
                <stat.icon className={`w-4 h-4 text-${stat.color}-400`} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-2xl font-bold text-white">{stat.value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {quickActions.map((action) => (
          <Link key={action.testId} href={action.href}>
            <div
              className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 hover:border-blue-500/30 hover:bg-[#111827]/80 transition-all cursor-pointer group"
              data-testid={action.testId}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                    <action.icon className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className="text-sm font-medium text-white">{action.label}</span>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {Array.isArray(activeTrips) && activeTrips.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden" data-testid="active-trips-section">
          <div className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Active Trips
            </h2>
            <Link href="/live">
              <span className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer" data-testid="link-view-live">
                View Live Map
              </span>
            </Link>
          </div>
          <div className="divide-y divide-[#1e293b]">
            {(activeTrips as any[]).slice(0, 5).map((trip: any) => (
              <div key={trip.id} className="px-5 py-3 flex items-center justify-between hover:bg-white/[0.02]" data-testid={`active-trip-${trip.id}`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-500/10 rounded-full flex items-center justify-center">
                    <Car className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm text-white">{trip.patientName || "Patient"}</p>
                    <p className="text-xs text-gray-500">{trip.pickupAddress || "Pickup"} → {trip.dropoffAddress || "Dropoff"}</p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  trip.status === "EN_ROUTE_PICKUP" ? "bg-blue-500/10 text-blue-400" :
                  trip.status === "EN_ROUTE_DROPOFF" ? "bg-cyan-500/10 text-cyan-400" :
                  trip.status === "ARRIVED_PICKUP" ? "bg-amber-500/10 text-amber-400" :
                  "bg-gray-500/10 text-gray-400"
                }`} data-testid={`trip-status-${trip.id}`}>
                  {(trip.status || "").replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5" data-testid="stat-patients">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-purple-400" />
            <span className="text-sm font-medium text-white">Total Patients</span>
          </div>
          {loading ? (
            <div className="h-8 w-16 bg-gray-800 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold text-white">{totalPatients}</p>
          )}
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5" data-testid="stat-rating">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-5 h-5 text-green-400" />
            <span className="text-sm font-medium text-white">Average Rating</span>
          </div>
          {loading ? (
            <div className="h-8 w-16 bg-gray-800 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold text-white">{avgRating > 0 ? avgRating.toFixed(1) : "N/A"}</p>
          )}
        </div>
      </div>
    </div>
  );
}
