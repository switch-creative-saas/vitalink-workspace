// VitaMind Scribe (Growth plan and up): with the patient's agreement it listens to the
// consultation, transcribes it a minute at a time, then drafts the SOAP note and picks out the
// symptoms. The symptoms open a VitaMind Dx analysis for the patient, so when the doctor signs the
// note with their diagnosis the engine learns from the case. Audio is never stored.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Ear, Loader2, Mic, Pause, Play, Sparkles, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AssistError, blobToBase64, discardScribe, draftScribeNote, startScribe, transcribeSegment,
  type ScribeAnalysis, type ScribeDraft,
} from '@/lib/supabase/assist';

const SEGMENT_MS = 60_000;
type Phase = 'consent' | 'listening' | 'paused' | 'finishing' | 'review' | 'drafting' | 'drafted';

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function ConsultationScribe({ organizationId, patientId, patientName, onApply, onClose }: {
  organizationId: string;
  patientId: string;
  patientName: string;
  onApply: (draft: ScribeDraft, analysis: ScribeAnalysis | null) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('consent');
  const [consent, setConsent] = useState(false);
  const [scribeId, setScribeId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [pending, setPending] = useState(0);
  const [draft, setDraft] = useState<ScribeDraft | null>(null);
  const [analysis, setAnalysis] = useState<ScribeAnalysis | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const segmentTimer = useRef(0);
  const tick = useRef(0);
  // Segments are sent one after another so the transcript stays in order.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mimeType = useRef(pickMimeType());
  const supported = mimeType.current !== null && Boolean(navigator.mediaDevices?.getUserMedia);

  const stopEverything = () => {
    window.clearTimeout(segmentTimer.current);
    window.clearInterval(tick.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  useEffect(() => stopEverything, []);

  const send = (id: string, blob: Blob, length: number) => {
    if (blob.size < 2000 || length < 2) return; // silence between pause and resume
    setPending((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        const audio = await blobToBase64(blob);
        const result = await transcribeSegment(organizationId, id, audio, blob.type || mimeType.current || 'audio/webm', length);
        setTranscript(result.transcript);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'A part of the conversation could not be transcribed');
        if (error instanceof AssistError && /limit|listening time|up to/i.test(error.message)) stopListening();
      } finally {
        setPending((n) => n - 1);
      }
    });
  };

  // One MediaRecorder per segment: each finished blob is a complete, playable file.
  const recordSegment = (id: string) => {
    if (!stream.current) return;
    const rec = new MediaRecorder(stream.current, { ...(mimeType.current ? { mimeType: mimeType.current } : {}), audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    // The next segment starts before this one's stop event fires, so keep this segment's own start.
    const startedAt = Date.now();
    rec.onstop = () => send(id, new Blob(chunks, { type: rec.mimeType }), Math.round((Date.now() - startedAt) / 1000));
    rec.start();
    recorder.current = rec;
    segmentTimer.current = window.setTimeout(() => {
      if (rec.state === 'recording') rec.stop();
      recordSegment(id);
    }, SEGMENT_MS);
  };

  const listen = async (id: string) => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast.error('Allow microphone access to use the scribe.');
      setPhase(scribeId ? 'paused' : 'consent');
      return;
    }
    recordSegment(id);
    tick.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    setPhase('listening');
  };

  const start = async () => {
    try {
      const { id } = await startScribe(organizationId, patientId);
      setScribeId(id);
      await listen(id);
    } catch (error) {
      if (error instanceof AssistError && error.code === 'upgrade_required') {
        toast.info(error.message);
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'subscription' } }));
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not start the scribe');
      }
    }
  };

  function stopListening(next: Phase = 'paused') {
    stopEverything();
    setPhase(next);
  }

  const finish = async () => {
    stopListening('finishing');
    await queue.current;
    setPhase('review');
  };

  const makeDraft = async () => {
    if (!scribeId) return;
    setPhase('drafting');
    try {
      const result = await draftScribeNote(organizationId, scribeId, transcript);
      setDraft(result.draft);
      setAnalysis(result.analysis);
      setPhase('drafted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not draft the note');
      setPhase('review');
    }
  };

  const discard = async () => {
    stopEverything();
    if (scribeId) await discardScribe(organizationId, scribeId).catch(() => undefined);
    toast.success('Scribe discarded. The transcript was deleted.');
    onClose();
  };

  const busy = pending > 0;
  const top = analysis?.conditions?.slice(0, 3) ?? [];

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 space-y-3 dark:border-violet-500/30 dark:bg-violet-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <Ear className="h-4 w-4 text-violet-700 dark:text-violet-300" />
        <h3 className="font-semibold text-slate-900 dark:text-slate-50">VitaMind Scribe</h3>
        {(phase === 'listening' || phase === 'paused') && (
          <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', phase === 'listening' ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-700')}>
            {phase === 'listening' && <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />}
            {phase === 'listening' ? 'Listening' : 'Paused'} · {clock(seconds)}
          </span>
        )}
        {busy && <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Transcribing…</span>}
        <button type="button" onClick={() => void discard()} className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" />{scribeId ? 'Discard' : 'Close'}</button>
      </div>

      {phase === 'consent' && (
        <>
          {!supported ? (
            <p className="text-sm text-amber-800">This browser can’t record audio. Use a recent Chrome, Edge or Safari.</p>
          ) : (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Listens to your conversation with {patientName}, writes it down and drafts the note. You review everything before it goes into the record.
              </p>
              <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                The patient has agreed to VitaMind listening to and transcribing this consultation. (Recorded with your name and the time. Audio is not kept.)
              </label>
              <Button className="gap-2 bg-violet-700 text-white hover:bg-violet-800" disabled={!consent} onClick={() => void start()}><Mic className="h-4 w-4" />Start listening</Button>
            </>
          )}
        </>
      )}

      {(phase === 'listening' || phase === 'paused' || phase === 'finishing') && (
        <>
          <div className="max-h-40 overflow-y-auto rounded-lg bg-white/80 p-3 text-sm text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
            {transcript || <span className="text-slate-400">The transcript appears here about a minute at a time…</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {phase === 'listening' && <Button variant="outline" className="gap-2" onClick={() => stopListening()}><Pause className="h-4 w-4" />Pause</Button>}
            {phase === 'paused' && scribeId && <Button variant="outline" className="gap-2" onClick={() => void listen(scribeId)}><Play className="h-4 w-4" />Resume</Button>}
            <Button className="gap-2 bg-violet-700 text-white hover:bg-violet-800" disabled={phase === 'finishing'} onClick={() => void finish()}>
              {phase === 'finishing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}{phase === 'finishing' ? 'Finishing…' : 'End consultation'}
            </Button>
          </div>
        </>
      )}

      {(phase === 'review' || phase === 'drafting') && (
        <>
          <p className="text-xs text-slate-500">Check the transcript and correct anything misheard, then draft the note.</p>
          <Textarea rows={6} value={transcript} onChange={(e) => setTranscript(e.target.value)} disabled={phase === 'drafting'} />
          <Button className="gap-2 bg-violet-700 text-white hover:bg-violet-800" disabled={phase === 'drafting' || transcript.trim().length < 20} onClick={() => void makeDraft()}>
            {phase === 'drafting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{phase === 'drafting' ? 'Drafting…' : 'Draft note'}
          </Button>
        </>
      )}

      {phase === 'drafted' && draft && (
        <div className="space-y-3 text-sm">
          {draft.red_flags.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" />Red flags</p>
              <ul className="ml-5 list-disc">{draft.red_flags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {([['Chief complaint', draft.chief_complaint], ['History', draft.history_of_present_illness], ['Review of systems', draft.review_of_systems], ['Examination', draft.examination], ['Assessment', draft.assessment], ['Plan', [draft.plan, draft.follow_up].filter(Boolean).join(' ')]] as const)
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="rounded-lg bg-white/80 p-2.5 dark:bg-slate-900/60"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="text-slate-800 dark:text-slate-200">{value}</p></div>
              ))}
          </div>
          {(draft.possible_diagnoses.length > 0 || top.length > 0) && (
            <div className="rounded-lg bg-white/80 p-2.5 dark:bg-slate-900/60">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Worth considering (decision support)</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.possible_diagnoses.map((dx) => <span key={dx.condition} title={dx.why} className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">{dx.condition} · {dx.likelihood}</span>)}
                {top.map((c) => <span key={c.id} className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">VitaMind Dx: {c.name} {Math.round(c.probability * 100)}%</span>)}
              </div>
            </div>
          )}
          {draft.questions_to_ask.length > 0 && (
            <div className="rounded-lg bg-white/80 p-2.5 dark:bg-slate-900/60">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Not asked yet</p>
              <ul className="ml-5 list-disc text-slate-700 dark:text-slate-300">{draft.questions_to_ask.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button className="gap-2 bg-violet-700 text-white hover:bg-violet-800" onClick={() => { onApply(draft, analysis); onClose(); }}><CheckCircle2 className="h-4 w-4" />Use in note</Button>
            <Button variant="outline" onClick={() => setPhase('review')}>Edit transcript</Button>
          </div>
          <p className="text-[11px] text-slate-500">Enter your own diagnosis in the note and sign it. VitaMind learns from the diagnoses doctors sign.</p>
        </div>
      )}
    </div>
  );
}
