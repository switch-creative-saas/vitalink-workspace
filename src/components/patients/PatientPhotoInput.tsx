// Patient photo at registration: take it live with the device camera (front or back), or upload
// one. The photo is shrunk on the device and stored privately (lib/supabase/patientPhotos).
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, RefreshCw, Trash2, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { shrinkPhoto, uploadPatientPhoto, usePatientPhoto } from '@/lib/supabase/patientPhotos';

export function PatientPhotoInput({ organizationId, value, onChange }: {
  organizationId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const preview = usePatientPhoto(value);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraFallback = useRef<HTMLInputElement>(null);
  const liveCamera = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const save = async (photo: Blob | HTMLCanvasElement) => {
    setBusy(true);
    try {
      onChange(await uploadPatientPhoto(organizationId, await shrinkPhoto(photo)));
      toast.success('Photo added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the photo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
      <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800">
        {busy ? <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          : preview ? <img src={preview} alt="Patient" className="h-full w-full object-cover" />
          : <User className="h-8 w-8 text-slate-400" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-gray-900 dark:text-slate-50">Patient photo <span className="font-normal text-gray-500">(optional)</span></p>
        <p className="text-xs text-gray-500">Helps the front desk recognise the patient. Kept private to your facility.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy}
            onClick={() => (liveCamera ? setCameraOpen(true) : cameraFallback.current?.click())}>
            <Camera className="h-4 w-4" />{value ? 'Retake' : 'Take photo'}
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => fileInput.current?.click()}>
            <ImagePlus className="h-4 w-4" />Upload
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-red-600" disabled={busy} onClick={() => onChange('')}>
              <Trash2 className="h-4 w-4" />Remove
            </Button>
          )}
        </div>
      </div>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden"
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void save(file); }} />
      <input ref={cameraFallback} type="file" accept="image/*" capture="user" className="hidden"
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void save(file); }} />
      {cameraOpen && <CameraCapture onClose={() => setCameraOpen(false)} onCapture={(canvas) => { setCameraOpen(false); void save(canvas); }} />}
    </div>
  );
}

/** Live camera shown in place in the form (inside the wizard window), with capture and front/back switch. */
function CameraCapture({ onCapture, onClose }: { onCapture: (canvas: HTMLCanvasElement) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 960 }, height: { ideal: 960 } }, audio: false })
      .then((media) => {
        if (cancelled) { media.getTracks().forEach((t) => t.stop()); return; }
        stream = media;
        if (video.current) { video.current.srcObject = media; void video.current.play().then(() => setReady(true)).catch(() => setReady(true)); }
      })
      .catch((err) => setError(err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Camera access is blocked. Allow it in the address bar, or use Upload instead.'
        : 'No camera was found on this device. Use Upload instead.'));
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [facing]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // A centred square, so every patient photo has the same shape.
    const side = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d')!;
    if (facing === 'user') { ctx.translate(side, 0); ctx.scale(-1, 1); } // keep what the patient saw on screen
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, side, side);
    onCapture(canvas);
  };

  return (
    <div className="relative flex w-full basis-full flex-col items-center gap-3 rounded-2xl bg-slate-950 p-4" role="group" aria-label="Take patient photo">
      <button type="button" aria-label="Close camera" onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X className="h-4 w-4" /></button>
      <div className="relative aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900">
        <video ref={video} playsInline muted className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`} />
        {!ready && !error && <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-8 w-8 animate-spin text-white/60" /></div>}
        {error && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">{error}</p>}
        <div className="pointer-events-none absolute inset-6 rounded-full border-2 border-white/30" />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button type="button" variant="outline" className="gap-1.5 border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
          <RefreshCw className="h-4 w-4" />Switch camera
        </Button>
        <button type="button" aria-label="Take photo" disabled={!ready} onClick={capture}
          className="grid h-16 w-16 place-items-center rounded-full border-4 border-white bg-white/20 transition hover:bg-white/30 disabled:opacity-40">
          <Camera className="h-6 w-6 text-white" />
        </button>
      </div>
      <p className="text-xs text-white/60">Centre the patient’s face in the circle.</p>
    </div>
  );
}
