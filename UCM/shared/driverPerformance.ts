export interface PerformanceKPIs {
  onTimeRate: number;
  lateCount: number;
  totalTrips: number;
  acceptanceRate: number;
  idleMinutes: number;
  cancelCount: number;
  complianceRate: number;
}

export interface ScoringWeights {
  punctuality: number;
  acceptance: number;
  idle: number;
  cancellations: number;
  compliance: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  punctuality: 45,
  acceptance: 20,
  idle: 15,
  cancellations: 10,
  compliance: 10,
};

export function computeTurnScore(kpis: PerformanceKPIs, weights: ScoringWeights = DEFAULT_WEIGHTS): number {
  const totalWeight = weights.punctuality + weights.acceptance + weights.idle + weights.cancellations + weights.compliance;
  if (totalWeight === 0) return 0;

  const punctualityScore = kpis.onTimeRate * 100;

  const acceptanceScore = kpis.acceptanceRate * 100;

  const maxIdleMinutes = 120;
  const idleScore = Math.max(0, 100 - (kpis.idleMinutes / maxIdleMinutes) * 100);

  const maxCancels = 5;
  const cancelScore = Math.max(0, 100 - (kpis.cancelCount / maxCancels) * 100);

  const complianceScore = kpis.complianceRate * 100;

  const weighted =
    (punctualityScore * weights.punctuality +
      acceptanceScore * weights.acceptance +
      idleScore * weights.idle +
      cancelScore * weights.cancellations +
      complianceScore * weights.compliance) /
    totalWeight;

  return Math.round(Math.min(100, Math.max(0, weighted)));
}

export function getGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function getGradeColor(grade: string): string {
  switch (grade) {
    case "A": return "text-emerald-600";
    case "B": return "text-blue-600";
    case "C": return "text-amber-600";
    case "D": return "text-orange-600";
    default: return "text-red-600";
  }
}
