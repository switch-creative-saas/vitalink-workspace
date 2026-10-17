import { requireSupabase } from './client';

const BUCKET = 'patient-documents';
const MAX_BYTES = 20 * 1024 * 1024;

export const DOCUMENT_CATEGORIES = ['Imaging', 'Consent forms', 'Referral letters', 'Discharge summary', 'Insurance files', 'External reports'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export interface PatientDocument {
  id: string;
  name: string;
  category: DocumentCategory;
  size: string;
  version: number;
  uploadedBy: string;
  uploadedAt: string;
  tags: string[];
  storagePath: string;
}

type Person = { full_name: string; email: string } | null;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function friendly(error: { code?: string; message: string; statusCode?: string }, action: string): Error {
  if (error.code === '42501' || error.statusCode === '403' || /row-level security|not authorized|unauthorized/i.test(error.message)) {
    return new Error(`Your role cannot ${action}.`);
  }
  if (/mime type|not supported/i.test(error.message)) return new Error('That file type is not allowed. Use PDF, images, Word or text files.');
  return new Error(error.message);
}

export async function listDocuments(organizationId: string, patientId: string): Promise<PatientDocument[]> {
  const { data, error } = await requireSupabase()
    .from('patient_documents')
    .select('id, name, category, size_bytes, version, tags, storage_path, created_at, uploader:profiles!patient_documents_uploaded_by_fkey(full_name, email)')
    .eq('organization_id', organizationId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throw friendly(error, 'view documents');
  return (data as unknown as Array<{
    id: string; name: string; category: DocumentCategory; size_bytes: number; version: number; tags: string[];
    storage_path: string; created_at: string; uploader: Person;
  }>).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    size: formatBytes(Number(row.size_bytes)),
    version: row.version,
    uploadedBy: row.uploader?.full_name || row.uploader?.email || '—',
    uploadedAt: row.created_at.slice(0, 10),
    tags: row.tags,
    storagePath: row.storage_path,
  }));
}

/** Uploads the file to the private bucket, then records it on the patient's chart. */
export async function uploadDocument(organizationId: string, patientId: string, file: File, category: DocumentCategory) {
  if (file.size > MAX_BYTES) throw new Error('Files must be 20 MB or smaller.');
  const db = requireSupabase();
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-120) || 'document';
  const path = `${organizationId}/${patientId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (uploadError) throw friendly(uploadError, 'upload documents');
  const { error } = await db.from('patient_documents').insert({
    organization_id: organizationId,
    patient_id: patientId,
    name: file.name,
    category,
    storage_path: path,
    mime_type: file.type,
    size_bytes: file.size,
  });
  if (error) {
    // Don't leave an orphaned file behind (only admins may delete, so this can fail quietly).
    await db.storage.from(BUCKET).remove([path]).catch(() => undefined);
    throw friendly(error, 'upload documents');
  }
}

/** A short-lived link to view (or download) a stored document. */
export async function documentLink(storagePath: string, options: { download?: boolean; expiresInSeconds?: number } = {}) {
  const { data, error } = await requireSupabase()
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, options.expiresInSeconds ?? 600, options.download ? { download: true } : undefined);
  if (error) throw friendly(error, 'open documents');
  return data.signedUrl;
}
