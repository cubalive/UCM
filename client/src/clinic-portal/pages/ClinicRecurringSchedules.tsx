import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  Plus,
  Clock,
  User,
  X,
  Loader2,
  Trash2,
  Edit3,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DAY_COLORS: Record<string, string> = {
  Mon: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Tue: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Wed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  Thu: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  Fri: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  Sat: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  Sun: "bg-red-500/20 text-red-400 border-red-500/30",
};

interface Schedule {
  id: number;
  patientId: number;
  days: string[];
  pickupTime: string;
  startDate: string;
  endDate?: string;
  active: boolean;
}

interface Patient {
  id: number;
  firstName: string;
  lastName: string;
  phone?: string;
}

function ScheduleFormModal({
  onClose,
  onSubmit,
  isPending,
  patients,
  initial,
}: {
  onClose: () => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
  patients: Patient[];
  initial?: Schedule;
}) {
  const [form, setForm] = useState({
    patientId: initial?.patientId || "",
    days: initial?.days || [],
    pickupTime: initial?.pickupTime || "08:00",
    startDate: initial?.startDate || new Date().toISOString().split("T")[0],
    endDate: initial?.endDate || "",
  });

  const toggleDay = (day: string) => {
    setForm(f => ({
      ...f,
      days: f.days.includes(day) ? f.days.filter(d => d !== day) : [...f.days, day],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patientId || !form.days.length || !form.pickupTime || !form.startDate) return;
    onSubmit({
      patientId: Number(form.patientId),
      days: form.days,
      pickupTime: form.pickupTime,
      startDate: form.startDate,
      endDate: form.endDate || undefined,
    });
  };

  const inputCls =
    "w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 placeholder-gray-600 transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} role="presentation" aria-hidden="true" />
      <div className="relative bg-[#111827] border border-[#1e293b] rounded-xl w-full max-w-lg mx-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="recurring-schedule-title">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e293b]">
          <h2 id="recurring-schedule-title" className="text-base font-semibold text-white flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-emerald-400" />
            {initial ? "Edit Schedule" : "New Recurring Schedule"}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {!initial && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Patient <span className="text-red-400">*</span>
              </label>
              <select
                value={form.patientId}
                onChange={(e) => setForm(f => ({ ...f, patientId: e.target.value }))}
                className={inputCls}
                required
              >
                <option value="">Select a patient</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}{p.phone ? ` (${p.phone})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-2">
              Days <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {DAYS.map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                    form.days.includes(day)
                      ? DAY_COLORS[day]
                      : "bg-[#0a0f1e] border-[#1e293b] text-gray-500 hover:border-gray-600"
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Pickup Time <span className="text-red-400">*</span>
            </label>
            <input
              type="time"
              value={form.pickupTime}
              onChange={(e) => setForm(f => ({ ...f, pickupTime: e.target.value }))}
              className={inputCls}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Start Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))}
                className={inputCls}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">End Date</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))}
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm text-gray-400 border border-[#1e293b] rounded-lg hover:bg-[#1e293b] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !form.patientId || !form.days.length}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isPending ? "Saving..." : initial ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ClinicRecurringSchedules() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const { data: schedules, isLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/clinic/recurring-schedules"],
    enabled: !!user?.clinicId,
  });

  const { data: patientsData } = useQuery<any>({
    queryKey: ["/api/clinic/patients"],
    enabled: !!user?.clinicId,
  });

  const patients: Patient[] = Array.isArray(patientsData) ? patientsData : (patientsData as any)?.patients || [];
  const patientMap = useMemo(() => new Map(patients.map(p => [p.id, p])), [patients]);
  const scheduleList = Array.isArray(schedules) ? schedules : [];

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/clinic/recurring-schedules", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/recurring-schedules"] });
      setShowForm(false);
      toast({ title: "Schedule created", description: "Recurring schedule has been added." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create schedule", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/clinic/recurring-schedules/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/recurring-schedules"] });
      setEditingSchedule(null);
      toast({ title: "Schedule updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/clinic/recurring-schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/recurring-schedules"] });
      toast({ title: "Schedule deactivated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  // Build weekly calendar view
  const weeklyView = useMemo(() => {
    const daySchedules: Record<string, Array<{ schedule: Schedule; patient: Patient | undefined }>> = {};
    DAYS.forEach(d => { daySchedules[d] = []; });
    for (const schedule of scheduleList) {
      for (const day of schedule.days) {
        if (daySchedules[day]) {
          daySchedules[day].push({ schedule, patient: patientMap.get(schedule.patientId) });
        }
      }
    }
    // Sort each day by pickup time
    for (const day of DAYS) {
      daySchedules[day].sort((a, b) => (a.schedule.pickupTime || "").localeCompare(b.schedule.pickupTime || ""));
    }
    return daySchedules;
  }, [scheduleList, patientMap]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="recurring-schedules-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-emerald-400" />
            Recurring Schedules
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage weekly recurring transport schedules</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
          data-testid="button-new-schedule"
        >
          <Plus className="w-4 h-4" />
          New Schedule
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <RotateCcw className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-gray-500">Active Schedules</span>
          </div>
          <p className="text-2xl font-bold text-white">{scheduleList.length}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-gray-500">Patients Scheduled</span>
          </div>
          <p className="text-2xl font-bold text-white">{new Set(scheduleList.map(s => s.patientId)).size}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="w-4 h-4 text-cyan-400" />
            <span className="text-xs text-gray-500">Weekly Trips</span>
          </div>
          <p className="text-2xl font-bold text-white">{scheduleList.reduce((s, sch) => s + sch.days.length, 0)}</p>
        </div>
      </div>

      {/* Weekly Calendar View */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden" data-testid="weekly-calendar">
        <div className="px-5 py-4 border-b border-[#1e293b]">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-cyan-400" />
            Weekly View
          </h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-7 divide-x divide-[#1e293b]">
            {DAYS.map((day, idx) => (
              <div key={day} className="min-h-[200px]">
                <div className={`px-2 py-2 text-center border-b border-[#1e293b] ${DAY_COLORS[day].split(" ")[0]}`}>
                  <p className="text-xs font-semibold text-white">{day}</p>
                  <p className="text-[10px] text-gray-400">{FULL_DAYS[idx]}</p>
                </div>
                <div className="p-1.5 space-y-1">
                  {weeklyView[day].length === 0 ? (
                    <p className="text-[10px] text-gray-600 text-center py-4">No trips</p>
                  ) : (
                    weeklyView[day].map(({ schedule, patient }) => (
                      <button
                        key={`${schedule.id}-${day}`}
                        onClick={() => setEditingSchedule(schedule)}
                        className={`w-full text-left px-2 py-1.5 rounded-md border transition-all hover:opacity-80 ${DAY_COLORS[day]}`}
                      >
                        <p className="text-[10px] font-medium truncate">
                          {patient ? `${patient.firstName} ${patient.lastName}` : `Patient #${schedule.patientId}`}
                        </p>
                        <p className="text-[9px] opacity-70 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {schedule.pickupTime}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schedule List */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden" data-testid="schedule-list">
        <div className="px-5 py-4 border-b border-[#1e293b]">
          <h2 className="text-sm font-semibold text-white">All Schedules</h2>
        </div>

        {scheduleList.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <RotateCcw className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm font-medium">No recurring schedules</p>
            <p className="text-xs mt-1">Create your first schedule to automate transport</p>
          </div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {scheduleList.map(schedule => {
              const patient = patientMap.get(schedule.patientId);
              return (
                <div key={schedule.id} className="px-5 py-4 flex items-center gap-4 hover:bg-[#0f172a] transition-colors">
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">
                      {patient ? `${patient.firstName} ${patient.lastName}` : `Patient #${schedule.patientId}`}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {schedule.pickupTime}
                      </span>
                      <span className="text-xs text-gray-500">
                        {schedule.startDate}{schedule.endDate ? ` to ${schedule.endDate}` : " (ongoing)"}
                      </span>
                    </div>
                    <div className="flex gap-1 mt-1.5">
                      {schedule.days.map(day => (
                        <span key={day} className={`text-[10px] px-1.5 py-0.5 rounded border ${DAY_COLORS[day] || "bg-gray-500/10 text-gray-400 border-gray-500/30"}`}>
                          {day}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingSchedule(schedule)}
                      className="p-2 text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Deactivate this recurring schedule?")) {
                          deleteMutation.mutate(schedule.id);
                        }
                      }}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <ScheduleFormModal
          onClose={() => setShowForm(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isPending={createMutation.isPending}
          patients={patients}
        />
      )}

      {editingSchedule && (
        <ScheduleFormModal
          onClose={() => setEditingSchedule(null)}
          onSubmit={(data) => updateMutation.mutate({ id: editingSchedule.id, ...data })}
          isPending={updateMutation.isPending}
          patients={patients}
          initial={editingSchedule}
        />
      )}
    </div>
  );
}
