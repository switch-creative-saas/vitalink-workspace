// VitaMind tools beside the workflow, through the vitamind-assist edge function:
// reading paper records from photos (Starter and up) and the consultation scribe (Growth and up).
import { requireSupabase } from './client';
import type { DxResult } from './diagnosis';

export class AssistError extends Error {
  code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}

async function assist<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('vitamind-assist', { body });
  if (error) {
    const payload = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new AssistError(payload?.error ?? 'VitaMind AI is unavailable right now.', payload?.code);
  }
  return data as T;
}

export const assistStatus = (organizationId: string) =>
  assist<{ ocr: boolean; scribe: boolean; configured: boolean }>({ action: 'status', organizationId });

// ---------- paper records ----------

export interface ExtractedPatient {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string | null;
  age_years: number | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  state: string | null;
  occupation: string | null;
  marital_status: string | null;
  blood_group: string | null;
  genotype: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  current_medications: string | null;
  emergency_contact_name: string | null;
  emergency_relationship: string | null;
  emergency_phone: string | null;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  hospital_number: string | null;
  confidence: 'high' | 'medium' | 'low';
  unclear_fields: string[];
}

export interface ExtractionResult { document_type: string; patients: ExtractedPatient[]; notes: string }

/** Shrinks a photo to at most `maxSide` px as JPEG so uploads stay small on mobile data. */
export async function preparePhoto(file: File, maxSide = 1600): Promise<{ mediaType: 'image/jpeg'; data: string; preview: string }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`${file.name} is not a photo this browser can read. Use JPEG or PNG.`);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const preview = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', data: preview.slice(preview.indexOf(',') + 1), preview };
}

export const extractPatients = (organizationId: string, images: Array<{ mediaType: string; data: string }>) =>
  assist<ExtractionResult>({ action: 'extract_patients', organizationId, images });

// ---------- consultation scribe ----------

export interface ScribeDraft {
  chief_complaint: string;
  history_of_present_illness: string;
  review_of_systems: string;
  examination: string;
  assessment: string;
  plan: string;
  follow_up: string;
  findings_present: string[];
  findings_absent: string[];
  possible_diagnoses: Array<{ condition: string; likelihood: 'high' | 'medium' | 'low'; why: string }>;
  red_flags: string[];
  questions_to_ask: string[];
}

/** VitaMind Dx's reading of the symptoms heard (dx_analyze), when any were recognised. */
export type ScribeAnalysis = DxResult;

export const startScribe = (organizationId: string, patientId: string) =>
  assist<{ id: string }>({ action: 'scribe_start', organizationId, patientId, consent: true });

export const transcribeSegment = (organizationId: string, scribeId: string, audio: string, mimeType: string, seconds: number) =>
  assist<{ text: string; transcript: string }>({ action: 'scribe_transcribe', organizationId, scribeId, audio, mimeType, seconds });

export const draftScribeNote = (organizationId: string, scribeId: string, transcript: string) =>
  assist<{ draft: ScribeDraft; analysis: ScribeAnalysis | null }>({ action: 'scribe_draft', organizationId, scribeId, transcript });

export const discardScribe = (organizationId: string, scribeId: string) =>
  assist<{ ok: true }>({ action: 'scribe_discard', organizationId, scribeId });

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const url = String(reader.result); resolve(url.slice(url.indexOf(',') + 1)); };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording'));
    reader.readAsDataURL(blob);
  });
}
