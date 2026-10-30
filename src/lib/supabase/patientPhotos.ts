// Patient photos: taken with the camera or uploaded at registration, shrunk on the device, and kept
// in the private patient-documents bucket under <organization>/patient-photos/. The patient record
// stores "storage:<path>"; screens turn that into a short-lived signed link (usePatientPhoto).
import { useEffect, useState } from 'react';
import { requireSupabase } from './client';

const BUCKET = 'patient-documents';
const PREFIX = 'storage:';
const MAX_SIDE = 512;

/** Shrinks any image (file or camera frame) to a small square-ish JPEG, about 30–60 KB. */
export async function shrinkPhoto(source: Blob | HTMLCanvasElement): Promise<Blob> {
  let canvas: HTMLCanvasElement;
  if (source instanceof HTMLCanvasElement) {
    canvas = source;
  } else {
    const bitmap = await createImageBitmap(source).catch(() => null);
    if (!bitmap) throw new Error('That file isn’t a photo this browser can read. Use JPEG or PNG.');
    canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) => out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process the photo'))), 'image/jpeg', 0.82));
}

/** Uploads a photo and returns the value to store on the patient record. */
export async function uploadPatientPhoto(organizationId: string, photo: Blob): Promise<string> {
  if (!navigator.onLine) throw new Error('Adding a photo needs a connection. Register the patient now and add the photo later.');
  const path = `${organizationId}/patient-photos/${crypto.randomUUID()}.jpg`;
  const { error } = await requireSupabase().storage.from(BUCKET).upload(path, photo, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    if (/row-level security|not authorized|unauthorized|403/i.test(error.message)) throw new Error('Your role cannot add patient photos.');
    throw new Error(error.message);
  }
  return `${PREFIX}${path}`;
}

const signed = new Map<string, { url: string; expires: number }>();

/** A displayable link for a stored photo value (older records may hold a plain web link). */
export function usePatientPhoto(value: string | undefined | null): string | null {
  const stored = value?.startsWith(PREFIX) ? value.slice(PREFIX.length) : null;
  const cached = stored ? signed.get(stored) : undefined;
  const [url, setUrl] = useState<string | null>(stored ? (cached && cached.expires > Date.now() ? cached.url : null) : value || null);

  useEffect(() => {
    if (!stored) { setUrl(value || null); return; }
    const hit = signed.get(stored);
    if (hit && hit.expires > Date.now()) { setUrl(hit.url); return; }
    let cancelled = false;
    void requireSupabase().storage.from(BUCKET).createSignedUrl(stored, 3600).then(({ data }) => {
      if (!data?.signedUrl || cancelled) return;
      signed.set(stored, { url: data.signedUrl, expires: Date.now() + 55 * 60_000 });
      setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [stored, value]);

  return url;
}
