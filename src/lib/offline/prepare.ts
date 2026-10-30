// Gets this device ready to work offline, the moment someone signs in, so no page has to have been
// opened first:
//
//  1. Every app file (all pages) is downloaded into the offline app cache (sw/service-worker.js).
//  2. Each table's recent rows are saved, encrypted, through the normal data layer (sync.ts), which
//     can then answer any page's question offline from them: lists, searches, counts, a patient's
//     notes, vitals, labs and prescriptions.
//  3. The overview screens' answers (dashboard, billing, pharmacy, lab, staff...) are saved as asked.
//  4. The browser is asked to keep this storage instead of clearing it when space runs low.
//
// It runs again in the background every 30 minutes while online, and when the connection returns,
// so what's on the device is never more than about half an hour old. Low-data mode saves less.
import { requireSupabase } from '@/lib/supabase/client';
import { getDataSaverPreference, isLowData } from '@/lib/network/dataSaver';
import * as administration from '@/lib/supabase/administration';
import * as appointments from '@/lib/supabase/appointments';
import * as billing from '@/lib/supabase/billing';
import * as dashboard from '@/lib/supabase/dashboard';
import * as diagnosis from '@/lib/supabase/diagnosis';
import * as insights from '@/lib/supabase/insights';
import * as lab from '@/lib/supabase/lab';
import * as network from '@/lib/supabase/network';
import * as nfcOrders from '@/lib/supabase/nfcOrders';
import * as pharmacy from '@/lib/supabase/pharmacy';
import * as plans from '@/lib/supabase/plans';
import * as security from '@/lib/supabase/security';
import * as staff from '@/lib/supabase/staff';
import * as support from '@/lib/supabase/support';
import * as telemedicine from '@/lib/supabase/telemedicine';

export interface OfflineReadiness {
  /** When the last full refresh finished. */
  preparedAt: string | null;
  /** Rows saved from the tables in the last refresh. */
  records: number;
  /** App files saved for offline use, out of all of them (null when unknown, e.g. in development). */
  appFiles: { cached: number; total: number } | null;
  /** The browser promised not to clear VitaLink's storage when space runs low. */
  persistent: boolean;
  running: boolean;
}

export const OFFLINE_READY_EVENT = 'vitalink:offline-ready';
const REFRESH_MS = 30 * 60_000;
const PAGE = 250;
const stateKey = (organizationId: string) => `vitalink-offline-ready:${organizationId}`;

let state: OfflineReadiness = { preparedAt: null, records: 0, appFiles: null, persistent: false, running: false };
let currentOrg: string | null = null;
let inFlight: Promise<void> | null = null;

function publish(patch: Partial<OfflineReadiness>) {
  state = { ...state, ...patch };
  window.dispatchEvent(new CustomEvent(OFFLINE_READY_EVENT, { detail: state }));
}

export function offlineReadiness(): OfflineReadiness {
  return state;
}

// Recent rows per table. Pages filter, search and page through these offline.
const TABLES: Array<{ table: string; order: string; ascending?: boolean; limit: number; recentDays?: { column: string; back: number; ahead?: number } }> = [
  { table: 'patients', order: 'created_at', limit: 3000 },
  { table: 'appointments', order: 'starts_at', limit: 2000, recentDays: { column: 'starts_at', back: 60, ahead: 60 } },
  { table: 'clinical_notes', order: 'updated_at', limit: 800 },
  { table: 'vitals', order: 'recorded_at', limit: 1200 },
  { table: 'lab_results', order: 'ordered_at', limit: 800 },
  { table: 'prescriptions', order: 'created_at', limit: 800 },
  { table: 'drug_inventory', order: 'drug_name', ascending: true, limit: 1500 },
  { table: 'service_prices', order: 'name', ascending: true, limit: 600 },
  { table: 'departments', order: 'name', ascending: true, limit: 200 },
  { table: 'patient_documents', order: 'created_at', limit: 600 },
];

async function saveTable(organizationId: string, spec: (typeof TABLES)[number], share: number): Promise<number> {
  const db = requireSupabase();
  const limit = Math.max(PAGE, Math.round(spec.limit * share));
  let saved = 0;
  for (let from = 0; from < limit; from += PAGE) {
    let query = db.from(spec.table).select('*').eq('organization_id', organizationId);
    if (spec.recentDays) {
      const day = 86_400_000;
      query = query.gte(spec.recentDays.column, new Date(Date.now() - spec.recentDays.back * day).toISOString());
      if (spec.recentDays.ahead) query = query.lte(spec.recentDays.column, new Date(Date.now() + spec.recentDays.ahead * day).toISOString());
    }
    const { data, error } = await query.order(spec.order, { ascending: spec.ascending ?? false }).range(from, from + PAGE - 1);
    if (error || !data) break; // this role can't read it, or the connection dropped
    saved += data.length;
    if (data.length < PAGE) break;
  }
  return saved;
}

/** The overview answers pages ask for on open, asked the same way so they're found offline. */
function screenAnswers(organizationId: string, lowData: boolean): Array<() => Promise<unknown>> {
  const base = [
    () => dashboard.getDashboardSummary(organizationId),
    () => dashboard.listRecentActivity(organizationId),
    () => dashboard.listIdentityScans(organizationId),
    () => plans.getEntitlements(organizationId),
    () => appointments.listCliniciansRemote(organizationId),
    () => administration.listDepartmentNames(organizationId),
    () => billing.listInvoices(organizationId),
    () => billing.listPayments(organizationId),
    () => billing.listPrices(organizationId),
    () => pharmacy.listInventory(organizationId),
    () => pharmacy.listPrescriptions(organizationId),
    () => lab.listLabOrders(organizationId),
    () => lab.listLabTemplates(organizationId),
    () => staff.listStaff(organizationId),
    () => diagnosis.listFindings(),
    () => diagnosis.listConditionNames(),
  ];
  if (lowData) return base;
  return [
    ...base,
    () => administration.getAdministrationOverview(organizationId),
    () => billing.listDrugPrices(organizationId),
    () => pharmacy.listPurchaseOrders(organizationId),
    () => staff.listInvitations(organizationId),
    () => insights.listInsights(organizationId),
    () => diagnosis.listActiveOutbreaks(organizationId),
    () => diagnosis.getModelStats(organizationId),
    () => network.listDirectory(),
    () => network.listTransfers(organizationId),
    () => nfcOrders.listOrders(organizationId),
    () => security.getSecurityPolicy(organizationId),
    () => support.listMyTickets(organizationId),
    () => telemedicine.listSessions(organizationId),
  ];
}

/** Asks the offline app cache to download every file, and reports how many it holds. */
async function appFiles(warm: boolean): Promise<{ cached: number; total: number } | null> {
  if (!('serviceWorker' in navigator)) return null;
  // On the very first visit the worker installs while the page is already open: wait for it.
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null; // development, or the browser refused it
  const worker = registration.active ?? (await navigator.serviceWorker.ready).active;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), warm ? 10 * 60_000 : 5000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      resolve(event.data as { cached: number; total: number });
    };
    worker.postMessage({ type: warm ? 'warm' : 'status' }, [channel.port2]);
  });
}

async function run(organizationId: string) {
  if (!navigator.onLine) return;
  publish({ running: true });
  try {
    if (navigator.storage?.persist) {
      const persistent = (await navigator.storage.persisted?.()) || (await navigator.storage.persist().catch(() => false));
      publish({ persistent });
    }
    const lowData = isLowData();
    // The app files go first and in the background; data follows straight away.
    const files = getDataSaverPreference() === 'on' ? appFiles(false) : appFiles(true);
    let records = 0;
    for (const spec of TABLES) records += await saveTable(organizationId, spec, lowData ? 0.25 : 1).catch(() => 0);
    for (const ask of screenAnswers(organizationId, lowData)) await ask().catch(() => undefined);
    const preparedAt = new Date().toISOString();
    try { localStorage.setItem(stateKey(organizationId), JSON.stringify({ preparedAt, records })); } catch { /* storage blocked */ }
    publish({ preparedAt, records, appFiles: await files });
  } finally {
    publish({ running: false });
  }
}

/** Prepares (or refreshes) offline use for this workspace now. */
export function prepareOffline(organizationId: string): Promise<void> {
  if (inFlight && currentOrg === organizationId) return inFlight;
  currentOrg = organizationId;
  inFlight = run(organizationId).finally(() => { inFlight = null; });
  return inFlight;
}

/** Starts the sign-in download and the background refreshes; returns a stop function. */
export function startOfflinePreparation(organizationId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(stateKey(organizationId)) ?? 'null') as { preparedAt: string; records: number } | null;
    state = { ...state, preparedAt: saved?.preparedAt ?? null, records: saved?.records ?? 0 };
  } catch { /* nothing saved yet */ }
  void appFiles(false).then((files) => publish({ appFiles: files }));

  const due = () => !state.preparedAt || Date.now() - new Date(state.preparedAt).getTime() > REFRESH_MS;
  const tick = () => { if (!document.hidden && navigator.onLine && due()) void prepareOffline(organizationId); };
  // A few seconds after sign-in, so the first screen loads first.
  const first = window.setTimeout(() => void prepareOffline(organizationId), 4000);
  const timer = window.setInterval(tick, 60_000);
  const online = () => void prepareOffline(organizationId);
  window.addEventListener('online', online);
  return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener('online', online); };
}
