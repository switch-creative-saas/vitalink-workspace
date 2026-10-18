// Read-only view of one record shared over the VitaLink Network (lab result,
// prescription, vitals, clinical note or document), used on the network page
// and in the receiving hospital's EMR.
import { Fragment } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { sharedDocumentLink, type RecordType } from '@/lib/supabase/network';

const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function RecordContent({ type, content: c }: { type: RecordType; content: Record<string, unknown> }) {
  const s = (key: string) => (c[key] == null || c[key] === '' ? null : String(c[key]));
  const rows: Array<[string, string | null]> =
    type === 'lab_result' ? [['Test', s('test_name')], ['Result', [s('value'), s('unit')].filter(Boolean).join(' ') || null], ['Reference', s('reference_range')], ['Flag', s('flag')], ['Interpretation', s('interpretation')], ['Resulted', s('resulted_at') && date(s('resulted_at'))]]
    : type === 'prescription' ? [['Drug', [s('drug_name'), s('generic_name') && `(${s('generic_name')})`].filter(Boolean).join(' ')], ['Dose', [s('dosage'), s('route'), s('frequency'), s('duration')].filter(Boolean).join(' · ')], ['Instructions', s('instructions')], ['Status', s('status')], ['Prescribed', s('prescribed_at') && date(s('prescribed_at'))]]
    : type === 'vitals' ? [['BP', c.systolic ? `${c.systolic}/${c.diastolic} mmHg` : null], ['Heart rate', c.heart_rate ? `${c.heart_rate} bpm` : null], ['Temperature', c.temperature_c ? `${c.temperature_c} °C` : null], ['SpO₂', c.spo2 ? `${c.spo2}%` : null], ['Resp. rate', s('respiratory_rate')], ['Weight', c.weight_kg ? `${c.weight_kg} kg` : null], ['Notes', s('notes')], ['Recorded', s('recorded_at') && date(s('recorded_at'))]]
    : type === 'note' ? [['Complaint', s('chief_complaint')], ['Diagnosis', s('primary_diagnosis')], ['Author', s('author')], ['Signed', s('signed_at') && date(s('signed_at'))]]
    : [['File', s('name')], ['Category', s('category')]];
  return (
    <div className="border-t border-slate-100 px-3 py-2 text-xs dark:border-slate-700">
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
        {rows.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd>{v}</dd></Fragment>)}
      </dl>
      {type === 'note' && c.content != null && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] dark:bg-slate-900/60">{noteText(c.content)}</pre>}
      {type === 'document' && s('storage_path') && (
        <Button size="sm" variant="outline" className="mt-2" onClick={async () => {
          const tab = window.open('', '_blank');
          try { const url = await sharedDocumentLink(String(c.storage_path)); if (tab) tab.location.href = url; else window.location.assign(url); }
          catch (error) { tab?.close(); toast.error(errorText(error, 'Could not open the document')); }
        }}>Open document</Button>
      )}
    </div>
  );
}

function noteText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    return Object.entries(content as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('\n');
  }
  return '';
}
