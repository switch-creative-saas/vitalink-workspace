import { requireSupabase } from './client';

export type LabOrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled';
export type LabOrderPriority = 'routine' | 'urgent' | 'stat';
export type LabSampleType = 'blood' | 'urine' | 'imaging' | 'other';

type Person = { full_name: string; email: string } | null;
const nameOf = (person: Person, fallback = '') => person?.full_name || person?.email || fallback;

function friendly(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '42501' || error.code === 'PGRST116') {
    // Trigger / RPC guards raise readable 42501 messages; plain RLS denials don't.
    return new Error(/already|only lab|cannot record/i.test(error.message) ? error.message : `Your role cannot ${action}.`);
  }
  if (error.code === '23505') return new Error('A template with that name already exists.');
  return new Error(error.message);
}

export interface LabLine {
  id: string;
  testName: string;
  value: string;
  unit: string;
  referenceRange: string;
  interpretation: string;
  critical: boolean;
  completed: boolean;
}

export interface LabOrderRecord {
  id: string;
  number: string;
  patientId: string;
  patientName: string;
  patientSwitchId: string;
  patientState: string;
  requestedBy: string;
  orderedById: string | null;
  priority: LabOrderPriority;
  sampleType: LabSampleType;
  status: LabOrderStatus;
  notes: string;
  critical: boolean;
  createdAt: string;
  completedAt: string | null;
  draftSavedAt: string | null;
  lines: LabLine[];
}

interface OrderRow {
  id: string;
  order_number: string;
  patient_id: string;
  ordered_by: string | null;
  priority: LabOrderPriority;
  sample_type: LabSampleType;
  status: LabOrderStatus;
  notes: string;
  critical: boolean;
  created_at: string;
  completed_at: string | null;
  draft_saved_at: string | null;
  patient: { first_name: string; last_name: string; switch_id: string; state: string | null } | null;
  orderer: Person;
  lines: Array<{
    id: string; test_name: string; value: string; unit: string; reference_range: string;
    interpretation: string | null; flag: string; status: 'Pending' | 'Completed'; ordered_at: string;
  }>;
}

const ORDER_SELECT = `id, order_number, patient_id, ordered_by, priority, sample_type, status, notes, critical, created_at, completed_at, draft_saved_at,
  patient:patients!lab_orders_patient_id_organization_id_fkey(first_name, last_name, switch_id, state),
  orderer:profiles!lab_orders_ordered_by_fkey(full_name, email),
  lines:lab_results(id, test_name, value, unit, reference_range, interpretation, flag, status, ordered_at)`;

const orderFromRow = (row: OrderRow): LabOrderRecord => ({
  id: row.id,
  number: row.order_number,
  patientId: row.patient_id,
  patientName: row.patient ? `${row.patient.first_name} ${row.patient.last_name}` : 'Unknown patient',
  patientSwitchId: row.patient?.switch_id ?? '',
  patientState: row.patient?.state ?? '',
  requestedBy: nameOf(row.orderer, '—'),
  orderedById: row.ordered_by,
  priority: row.priority,
  sampleType: row.sample_type,
  status: row.status,
  notes: row.notes,
  critical: row.critical,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  draftSavedAt: row.draft_saved_at,
  lines: [...(row.lines ?? [])]
    .sort((a, b) => a.ordered_at.localeCompare(b.ordered_at) || a.test_name.localeCompare(b.test_name))
    .map((line) => ({
      id: line.id,
      testName: line.test_name,
      value: line.value,
      unit: line.unit,
      referenceRange: line.reference_range,
      interpretation: line.interpretation ?? '',
      critical: line.flag === 'Critical',
      completed: line.status === 'Completed',
    })),
});

export async function listLabOrders(organizationId: string): Promise<LabOrderRecord[]> {
  const { data, error } = await requireSupabase()
    .from('lab_orders')
    .select(ORDER_SELECT)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw friendly(error, 'view lab orders');
  return (data as unknown as OrderRow[]).map(orderFromRow);
}

export interface NewLabTest {
  name: string;
  unit?: string;
  referenceRange?: string;
  /** EMR only: a test sent with a value is recorded as finished. */
  value?: string;
  flag?: 'Normal' | 'High' | 'Low' | 'Critical';
  testType?: string;
  department?: string;
}

export async function createLabOrder(
  patientId: string,
  tests: NewLabTest[],
  options: { priority?: LabOrderPriority; sampleType?: LabSampleType; notes?: string; noteId?: string } = {},
): Promise<string> {
  const { data, error } = await requireSupabase().rpc('create_lab_order', {
    p_patient_id: patientId,
    p_tests: tests,
    p_priority: options.priority ?? 'routine',
    p_sample_type: options.sampleType ?? 'blood',
    p_notes: options.notes ?? '',
    p_note_id: options.noteId ?? null,
  });
  if (error) throw friendly(error, 'order lab tests');
  return data as string;
}

export async function setLabOrderStatus(orderId: string, status: Exclude<LabOrderStatus, 'completed'>) {
  const { error } = await requireSupabase().from('lab_orders').update({ status }).eq('id', orderId).select('id').single();
  if (error) throw friendly(error, 'update lab orders');
}

export async function deleteLabOrder(orderId: string) {
  const { error, count } = await requireSupabase().from('lab_orders').delete({ count: 'exact' }).eq('id', orderId);
  if (error) throw friendly(error, 'delete lab orders');
  if (!count) throw new Error('Only workspace admins can delete lab orders.');
}

/** Saves a draft, or submits (and completes) the order when `complete` is set. */
export async function saveLabResults(
  orderId: string,
  lines: Array<Pick<LabLine, 'id' | 'value' | 'unit' | 'referenceRange' | 'interpretation' | 'critical'>>,
  complete: boolean,
) {
  const { error } = await requireSupabase().rpc('save_lab_results', {
    p_order_id: orderId,
    p_lines: lines,
    p_complete: complete,
  });
  if (error) throw friendly(error, 'record lab results');
}

// ---------- templates ----------

export interface LabTemplateRecord {
  id: string;
  name: string;
  fields: { name: string; unit: string; referenceRange: string }[];
}

export async function listLabTemplates(organizationId: string): Promise<LabTemplateRecord[]> {
  const { data, error } = await requireSupabase()
    .from('lab_templates')
    .select('id, name, fields')
    .eq('organization_id', organizationId)
    .order('name');
  if (error) throw friendly(error, 'view lab templates');
  return data as LabTemplateRecord[];
}

export async function saveLabTemplate(organizationId: string, template: Omit<LabTemplateRecord, 'id'> & { id?: string }) {
  const db = requireSupabase();
  const fields = { name: template.name.trim(), fields: template.fields };
  const { error } = template.id
    ? await db.from('lab_templates').update(fields).eq('id', template.id).select('id').single()
    : await db.from('lab_templates').insert({ ...fields, organization_id: organizationId });
  if (error) throw friendly(error, 'manage lab templates');
}

export async function deleteLabTemplate(id: string) {
  const { error } = await requireSupabase().from('lab_templates').delete().eq('id', id);
  if (error) throw friendly(error, 'manage lab templates');
}
