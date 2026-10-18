// Analytics page data: one call computes every figure for a time range from the
// workspace's own records. Sections the caller's role may not see come back null.
import { requireSupabase } from './client';

export type AnalyticsRange = '24h' | '7d' | '30d' | '90d';

const naira = (kobo: unknown) => Number(kobo ?? 0) / 100;

export interface AnalyticsOverview {
  range: AnalyticsRange;
  from: string;
  to: string;
  patients: { total: number; new: number; newPrev: number; seen: number; returning: number } | null;
  appointments: {
    total: number; totalPrev: number; completed: number; noShow: number; cancelled: number; telemedicine: number;
    avgWaitMin: number | null; avgConsultMin: number | null;
    heatmap: Array<{ dow: number; hour: number; count: number }>;
    noShowByDow: Array<{ dow: number; rate: number; total: number }>;
  } | null;
  departments: Array<{ department: string; appointments: number; completed: number; noShow: number; patients: number; avgWaitMin: number | null }> | null;
  revenue: { collected: number; collectedPrev: number; invoiced: number; outstanding: number; overdue: number; byCategory: Record<string, number> } | null;
  lab: { orders: number; completed: number; open: number; cancelled: number; critical: number; abnormal: number; avgTurnaroundH: number | null; topTests: Array<{ name: string; count: number }> } | null;
  pharmacy: { dispensed: number; awaiting: number; revenue: number; lowStock: number; expiring60d: number; expired: number; topDrugs: Array<{ name: string; count: number }> } | null;
  insurance: { submitted: number; approved: number; rejected: number; pending: number; claimed: number; approvedAmount: number; avgDays: number | null } | null;
  trend: Array<{ at: string; newPatients: number | null; appointments: number | null; revenue: number | null }>;
}

const num = (v: unknown) => Number(v ?? 0);
const opt = (v: unknown) => (v == null ? null : Number(v));

export async function getAnalyticsOverview(organizationId: string, range: AnalyticsRange): Promise<AnalyticsOverview> {
  const { data, error } = await requireSupabase().rpc('analytics_overview', { p_organization_id: organizationId, p_range: range });
  if (error) throw new Error(error.message);
  const r = data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    range, from: r.from, to: r.to,
    patients: r.patients ? { total: num(r.patients.total), new: num(r.patients.new), newPrev: num(r.patients.new_prev), seen: num(r.patients.seen), returning: num(r.patients.returning) } : null,
    appointments: r.appointments ? {
      total: num(r.appointments.total), totalPrev: num(r.appointments.total_prev), completed: num(r.appointments.completed),
      noShow: num(r.appointments.no_show), cancelled: num(r.appointments.cancelled), telemedicine: num(r.appointments.telemedicine),
      avgWaitMin: opt(r.appointments.avg_wait_min), avgConsultMin: opt(r.appointments.avg_consult_min),
      heatmap: (r.appointments.heatmap ?? []).map((h: Record<string, unknown>) => ({ dow: num(h.dow), hour: num(h.hour), count: num(h.count) })),
      noShowByDow: (r.appointments.no_show_by_dow ?? []).map((h: Record<string, unknown>) => ({ dow: num(h.dow), rate: num(h.rate), total: num(h.total) })),
    } : null,
    departments: r.departments ? r.departments.map((d: Record<string, unknown>) => ({
      department: String(d.department), appointments: num(d.appointments), completed: num(d.completed), noShow: num(d.no_show),
      patients: num(d.patients), avgWaitMin: opt(d.avg_wait_min),
    })) : null,
    revenue: r.revenue ? {
      collected: naira(r.revenue.collected_kobo), collectedPrev: naira(r.revenue.collected_prev_kobo), invoiced: naira(r.revenue.invoiced_kobo),
      outstanding: naira(r.revenue.outstanding_kobo), overdue: naira(r.revenue.overdue_kobo),
      byCategory: Object.fromEntries(Object.entries(r.revenue.by_category ?? {}).map(([k, v]) => [k, naira(v)])),
    } : null,
    lab: r.lab ? {
      orders: num(r.lab.orders), completed: num(r.lab.completed), open: num(r.lab.open), cancelled: num(r.lab.cancelled), critical: num(r.lab.critical),
      abnormal: num(r.lab.abnormal), avgTurnaroundH: opt(r.lab.avg_turnaround_h),
      topTests: (r.lab.top_tests ?? []).map((t: Record<string, unknown>) => ({ name: String(t.test), count: num(t.count) })),
    } : null,
    pharmacy: r.pharmacy ? {
      dispensed: num(r.pharmacy.dispensed), awaiting: num(r.pharmacy.awaiting), revenue: naira(r.pharmacy.revenue_kobo), lowStock: num(r.pharmacy.low_stock),
      expiring60d: num(r.pharmacy.expiring_60d), expired: num(r.pharmacy.expired),
      topDrugs: (r.pharmacy.top_drugs ?? []).map((t: Record<string, unknown>) => ({ name: String(t.drug), count: num(t.count) })),
    } : null,
    insurance: r.insurance ? {
      submitted: num(r.insurance.submitted), approved: num(r.insurance.approved), rejected: num(r.insurance.rejected), pending: num(r.insurance.pending),
      claimed: naira(r.insurance.claimed_kobo), approvedAmount: naira(r.insurance.approved_kobo), avgDays: opt(r.insurance.avg_days),
    } : null,
    trend: (r.trend ?? []).map((t: Record<string, unknown>) => ({
      at: String(t.at), newPatients: opt(t.new_patients), appointments: opt(t.appointments), revenue: t.revenue_kobo == null ? null : naira(t.revenue_kobo),
    })),
  };
}
