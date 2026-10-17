// Public page a patient opens from their video-visit link (/visit?t=<token>).
// No account: the token identifies the visit. The patient previews their
// camera, joins the waiting room, and is connected when the clinician admits them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { checkInToVisit, type VisitInfo } from '@/lib/supabase/telemedicine';
import { openCameraAndMic, VideoCall, type CallState } from '@/lib/telemedicine/videoCall';

const token = () => new URLSearchParams(window.location.search).get('t') ?? '';

export function PatientVisitPage() {
  const [info, setInfo] = useState<VisitInfo | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [state, setState] = useState<CallState>('idle');
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const callRef = useRef<VideoCall | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);

  // Validate the link.
  useEffect(() => {
    checkInToVisit(token())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  // Stay checked in while waiting, so the clinician sees the patient as present.
  useEffect(() => {
    if (!joined || state === 'connected' || state === 'ended') return;
    const timer = window.setInterval(() => { void checkInToVisit(token()).then((next) => next && setInfo(next)); }, 25_000);
    return () => window.clearInterval(timer);
  }, [joined, state]);

  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = local; }, [local]);
  useEffect(() => { if (remoteVideo.current) remoteVideo.current.srcObject = remote; }, [remote]);
  useEffect(() => () => { void callRef.current?.hangUp(); local?.getTracks().forEach((track) => track.stop()); }, [local]);

  const preview = useCallback(async () => {
    setError('');
    try {
      const media = await openCameraAndMic();
      setLocal(media.stream);
      if (media.note) setError(media.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the camera');
    }
  }, []);

  const join = async () => {
    if (!local) return;
    const call = new VideoCall({
      roomToken: token(),
      role: 'guest',
      onRemoteStream: setRemote,
      onState: setState,
      onEnded: () => setInfo((current) => (current ? { ...current, status: 'ended' } : current)),
      // Backup for a lost "end" message: ask the server whether the visit is over.
      onPeerLeft: () => { void checkInToVisit(token()).then((next) => next && setInfo(next)); },
    });
    callRef.current = call;
    await call.start(local);
    setJoined(true);
  };

  const leave = async () => {
    await callRef.current?.hangUp();
    callRef.current = null;
    local?.getTracks().forEach((track) => track.stop());
    setLocal(null);
    setJoined(false);
    setState('ended');
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="px-4 py-3 flex items-center justify-between border-b border-white/10">
        <span className="font-semibold">VitaLink <span className="text-white/60 font-normal">· Video visit</span></span>
        {info && <span className="text-xs text-white/60 truncate">{info.facility}</span>}
      </header>
      <main className="flex-1 flex items-center justify-center p-4">{children}</main>
    </div>
  );

  if (info === undefined) return shell(<p className="text-white/70">Checking your visit link...</p>);
  if (info === null) {
    return shell(
      <div className="max-w-sm text-center space-y-2">
        <h1 className="text-xl font-semibold">This visit link isn't valid</h1>
        <p className="text-sm text-white/70">Check that you opened the full link your clinic sent, or ask them for a new one.</p>
      </div>,
    );
  }
  if (info.status === 'ended' || info.status === 'cancelled' || state === 'ended') {
    return shell(
      <div className="max-w-sm text-center space-y-2">
        <h1 className="text-xl font-semibold">{info.status === 'cancelled' ? 'This visit was cancelled' : 'Your visit has ended'}</h1>
        <p className="text-sm text-white/70">Thank you{info.patientFirstName ? `, ${info.patientFirstName}` : ''}. You can close this page.</p>
      </div>,
    );
  }

  const connected = state === 'connected';
  return shell(
    <div className="w-full max-w-4xl space-y-4">
      {!joined && (
        <div className="text-center space-y-1">
          <h1 className="text-xl sm:text-2xl font-semibold">Hello{info.patientFirstName ? ` ${info.patientFirstName}` : ''}</h1>
          <p className="text-sm text-white/70">
            Video visit with {info.clinician} at {info.facility}
            {info.scheduledFor ? ` · ${new Date(info.scheduledFor).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>
      )}

      <div className="relative aspect-video w-full rounded-2xl bg-black overflow-hidden">
        <video ref={remoteVideo} autoPlay playsInline className={connected ? 'w-full h-full object-cover' : 'hidden'} />
        {!connected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 gap-2">
            {joined ? (
              <>
                <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                <p className="font-medium">{state === 'reconnecting' ? 'Reconnecting...' : state === 'connecting' ? 'Connecting...' : `You're in the waiting room`}</p>
                <p className="text-sm text-white/60">{state === 'failed' ? 'The connection failed. Leave and rejoin, or try another network.' : `${info.clinician} will let you in shortly. Keep this page open.`}</p>
              </>
            ) : (
              <p className="text-sm text-white/60">
                {!local ? 'Turn on your camera and microphone to join.'
                  : local.getVideoTracks().length ? 'Your camera is ready.'
                    : local.getAudioTracks().length ? 'Your microphone is ready (no camera).' : 'You can join without a camera or microphone.'}
              </p>
            )}
          </div>
        )}
        {local && (
          <video ref={localVideo} autoPlay playsInline muted className="absolute bottom-3 right-3 w-28 sm:w-40 aspect-video rounded-xl border border-white/20 object-cover bg-slate-800 -scale-x-100" />
        )}
      </div>

      {error && <p className="text-sm text-red-300 text-center">{error}</p>}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {!local && <Button onClick={() => void preview()} className="bg-[#1E4ED8] text-white"><Video className="w-4 h-4 mr-2" />Turn on camera</Button>}
        {local && !joined && <Button onClick={() => void join()} className="bg-emerald-600 hover:bg-emerald-700 text-white">Join the waiting room</Button>}
        {local && (
          <>
            <Button variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20" onClick={() => { const next = !micOn; setMicOn(next); local.getAudioTracks().forEach((t) => { t.enabled = next; }); }}>
              {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </Button>
            <Button variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20" onClick={() => { const next = !camOn; setCamOn(next); local.getVideoTracks().forEach((t) => { t.enabled = next; }); }}>
              {camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </Button>
          </>
        )}
        {joined && <Button onClick={() => void leave()} className="bg-red-600 hover:bg-red-700 text-white"><PhoneOff className="w-4 h-4 mr-2" />Leave</Button>}
      </div>
      <p className="text-center text-[11px] text-white/40">Video and audio go directly between you and the clinic and are encrypted. Nothing is recorded.</p>
    </div>,
  );
}
