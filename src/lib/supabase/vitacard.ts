// VitaCards: each patient's card carries a link (https://<app>/card/<token>). Tapping it shows the
// emergency profile; the patient's PIN, set at the hospital, unlocks their full record for 15
// minutes. Staff manage cards with the card_* database functions; the public page talks to the
// vitacard edge function (no sign-in).
import { requireSupabase } from './client';

// ---------- staff ----------

export interface PatientCard { id: string; token: string; status: 'active' | 'disabled'; lockedUntil: string | null; createdAt: string; lastUsedAt: string | null }

/**
 * Where card links point. With VITE_PUBLIC_CARD_URL (the card's own address, e.g.
 * https://card.vitalink.africa) a link is that address + the card's token: short, so it fits any
 * NFC tag. Otherwise it is the app's address + /card/<token>.
 */
const trim = (url: string | undefined) => url?.trim().replace(/\/+$/, '') || '';
export function cardLink(token: string) {
  const cardSite = trim(import.meta.env.VITE_PUBLIC_CARD_URL as string | undefined);
  if (cardSite) return `${cardSite}/${token}`;
  return `${trim(import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || window.location.origin}/card/${token}`;
}

const friendly = (error: { code?: string; message: string }, action: string) =>
  new Error(error.code === '42501' ? `Your role cannot ${action}.` : error.message);

export async function getActiveCard(patientId: string): Promise<PatientCard | null> {
  const { data, error } = await requireSupabase().from('patient_cards')
    .select('id, token, status, locked_until, created_at, last_used_at')
    .eq('patient_id', patientId).eq('status', 'active').maybeSingle();
  if (error) throw friendly(error, 'view VitaCards');
  if (!data) return null;
  return { id: data.id, token: data.token, status: data.status, lockedUntil: data.locked_until, createdAt: data.created_at, lastUsedAt: data.last_used_at };
}

/** Links a (new) card to the patient with the PIN they chose. Any earlier card stops working. */
export async function issueCard(patientId: string, pin: string): Promise<{ id: string; token: string }> {
  const { data, error } = await requireSupabase().rpc('card_issue', { p_patient_id: patientId, p_pin: pin });
  if (error) throw friendly(error, 'set up VitaCards');
  return data as { id: string; token: string };
}

export async function setCardPin(cardId: string, pin: string) {
  const { error } = await requireSupabase().rpc('card_set_pin', { p_card_id: cardId, p_pin: pin });
  if (error) throw friendly(error, 'change VitaCard PINs');
}

export async function disableCard(cardId: string) {
  const { error } = await requireSupabase().rpc('card_disable', { p_card_id: cardId });
  if (error) throw friendly(error, 'disable VitaCards');
}

export interface CardHolder { id: string; switchId: string; firstName: string; lastName: string; profilePhoto: string | null }
export interface WorkspaceCard extends PatientCard { patient: CardHolder }
export interface CardAccess { id: number; kind: 'emergency' | 'unlock' | 'wrong_pin' | 'locked' | 'records'; at: string; patient: CardHolder | null }

type HolderRow = { id: string; switch_id: string; first_name: string; last_name: string; profile_photo_url: string | null } | null;
const holder = (p: HolderRow): CardHolder | null => (p ? { id: p.id, switchId: p.switch_id, firstName: p.first_name, lastName: p.last_name, profilePhoto: p.profile_photo_url } : null);

/** Every active card in the workspace, most recently set up first. */
export async function listWorkspaceCards(organizationId: string): Promise<WorkspaceCard[]> {
  const { data, error } = await requireSupabase().from('patient_cards')
    .select('id, token, status, locked_until, created_at, last_used_at, patient:patients(id, switch_id, first_name, last_name, profile_photo_url)')
    .eq('organization_id', organizationId).eq('status', 'active').order('created_at', { ascending: false }).limit(500);
  if (error) throw friendly(error, 'view VitaCards');
  return (data ?? []).flatMap((row) => {
    const patient = holder(row.patient as unknown as HolderRow);
    return patient ? [{ id: row.id, token: row.token, status: row.status, lockedUntil: row.locked_until, createdAt: row.created_at, lastUsedAt: row.last_used_at, patient }] : [];
  });
}

/** Who opened which card, and wrong PINs (admins only; empty for other roles). */
export async function listCardAccess(organizationId: string, limit = 60): Promise<CardAccess[]> {
  const { data, error } = await requireSupabase().from('card_access_log')
    .select('id, kind, at, patient:patients(id, switch_id, first_name, last_name, profile_photo_url)')
    .eq('organization_id', organizationId).order('at', { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []).map((row) => ({ id: row.id, kind: row.kind, at: row.at, patient: holder(row.patient as unknown as HolderRow) }));
}

/** Same rule as the database: 4–6 digits, not one repeated digit, not a run like 1234 or 9876. */
export function pinProblem(pin: string): string | null {
  if (!/^[0-9]{4,6}$/.test(pin)) return 'Use 4 to 6 digits.';
  if (/^(.)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'Too easy to guess. Avoid one repeated digit or a run like 1234.';
  return null;
}

/** Writes the card link onto an NFC tag (Chrome on Android; elsewhere the link is copied instead). */
export async function writeCardTag(token: string): Promise<'written' | 'unsupported'> {
  const Reader = (window as Window & { NDEFReader?: new () => { write: (message: unknown) => Promise<void> } }).NDEFReader;
  if (!Reader) return 'unsupported';
  await new Reader().write({ records: [{ recordType: 'url', data: cardLink(token) }] });
  return 'written';
}

// ---------- public (card holder or first responder) ----------

export interface CardEmergency {
  firstName: string; lastName: string; vitalinkId: string; age: number | null; sex: string | null;
  bloodGroup: string | null; genotype: string | null; allergies: string | null; conditions: string | null;
  pregnancy: string | null; disability: string | null; medicines: string[];
  emergencyContact: { name: string | null; relationship: string | null; phone: string | null };
  hospital: { name: string; phone: string | null; address: string | null };
  photo: string | null; fullRecordsAvailable: boolean; locked: boolean;
}

export interface CardRecords {
  profile: Record<string, string | null> & {
    insurance: Record<string, string | null>;
    emergencyContact: Record<string, string | null>;
  };
  hospital: { name: string; phone: string | null; email: string | null; address: string | null };
  prescriptions: Array<{ drug: string; dosage: string | null; frequency: string | null; duration: string | null; route: string | null; instructions: string | null; status: string; date: string }>;
  appointments: Array<{ at: string; type: string; department: string | null; status: string; reason: string | null; clinician: string | null }>;
  labResults: Array<{ test: string; value: string | null; unit: string | null; flag: string | null; range: string | null; interpretation: string | null; date: string }>;
  visits: Array<{ date: string; complaint: string | null; diagnosis: string | null; clinician: string | null; followUp: string | null }>;
  vitals: Array<{ at: string; temperature: number | null; pulse: number | null; systolic: number | null; diastolic: number | null; spo2: number | null; weight: number | null; height: number | null }>;
}

export type UnlockResult =
  | { ok: true; session: string; expiresAt: string }
  | { ok: false; reason: 'wrong_pin' | 'locked' | 'emergency_only' | 'not_found'; attemptsLeft?: number; until?: string | null };

async function card<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('vitacard', { body });
  if (error) {
    const payload = await (error as { context?: Response }).context?.json?.().catch(() => null);
    const failure = new Error(payload?.error ?? 'Could not reach VitaLink. Check your connection.') as Error & { status?: number };
    failure.status = (error as { context?: Response }).context?.status;
    throw failure;
  }
  return data as T;
}

export const cardEmergency = (token: string) => card<CardEmergency>({ action: 'emergency', token });
export const cardUnlock = (token: string, pin: string) => card<UnlockResult>({ action: 'unlock', token, pin });
export const cardRecords = (session: string) => card<CardRecords>({ action: 'records', session });
export const cardLock = (session: string) => card<{ ok: true }>({ action: 'lock', session }).catch(() => undefined);
