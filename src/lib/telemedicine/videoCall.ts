// One-to-one video call over WebRTC. Media goes browser-to-browser (encrypted
// by WebRTC); a Supabase Realtime broadcast channel named after the session's
// random room token carries only the offer/answer/ICE messages.
//
// The host (clinician who admits) makes the offer once the guest is present;
// the guest answers. If either side reloads, presence brings them back
// together and the host renegotiates.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '@/lib/supabase/client';

export type CallRole = 'host' | 'guest';
export type CallState = 'idle' | 'waiting-for-peer' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';

type Signal =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'hello' }
  | { type: 'bye' }
  | { type: 'end' };

/** STUN by default; set VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL for networks that block direct connections. */
function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turn = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turn) {
    servers.push({
      urls: turn.split(',').map((url) => url.trim()),
      username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
    });
  }
  return servers;
}

export interface VideoCallOptions {
  roomToken: string;
  role: CallRole;
  onRemoteStream: (stream: MediaStream | null) => void;
  onState: (state: CallState) => void;
  onPeerLeft?: () => void;
  /** The host ended the visit for everyone. */
  onEnded?: () => void;
}

export class VideoCall {
  private pc: RTCPeerConnection | null = null;
  private channel: RealtimeChannel | null = null;
  private local: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private closed = false;
  private readonly opts: VideoCallOptions;

  constructor(opts: VideoCallOptions) {
    this.opts = opts;
  }

  /** Joins the room with the given camera/microphone stream. */
  async start(local: MediaStream) {
    this.local = local;
    this.opts.onState('waiting-for-peer');
    const db = requireSupabase();
    this.channel = db.channel(`tele-${this.opts.roomToken}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: `${this.opts.role}-${crypto.randomUUID()}` } },
    });
    this.channel
      .on('broadcast', { event: 'signal' }, ({ payload }) => void this.handle(payload as Signal))
      .on('presence', { event: 'join' }, ({ key }) => {
        // Host (re)offers whenever the guest arrives.
        if (this.opts.role === 'host' && key.startsWith('guest-')) void this.makeOffer();
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        const other = this.opts.role === 'host' ? 'guest-' : 'host-';
        if (key.startsWith(other) && !this.closed) {
          this.opts.onState('reconnecting');
          this.opts.onPeerLeft?.();
        }
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED' || !this.channel) return;
        await this.channel.track({ role: this.opts.role, at: Date.now() });
        // A guest arriving after the host asks for an offer; a host arriving late offers if a guest is there.
        if (this.opts.role === 'guest') this.send({ type: 'hello' });
        else if (this.peerPresent()) void this.makeOffer();
      });
  }

  private peerPresent() {
    const state = this.channel?.presenceState() ?? {};
    const other = this.opts.role === 'host' ? 'guest-' : 'host-';
    return Object.keys(state).some((key) => key.startsWith(other));
  }

  private send(signal: Signal) {
    void this.channel?.send({ type: 'broadcast', event: 'signal', payload: signal });
  }

  private newPeer() {
    this.pc?.close();
    this.pendingIce = [];
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.local?.getTracks().forEach((track) => pc.addTrack(track, this.local as MediaStream));
    // Without a camera or microphone we still want to see and hear the other side.
    if (!this.local?.getAudioTracks().length) pc.addTransceiver('audio', { direction: 'recvonly' });
    if (!this.local?.getVideoTracks().length) pc.addTransceiver('video', { direction: 'recvonly' });
    if (this.screen) {
      const screenTrack = this.screen.getVideoTracks()[0];
      const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
      if (screenTrack && sender) void sender.replaceTrack(screenTrack);
    }
    const remote = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => { if (!remote.getTracks().includes(track)) remote.addTrack(track); });
      if (!event.streams[0]) remote.addTrack(event.track);
      this.opts.onRemoteStream(remote);
    };
    pc.onicecandidate = (event) => { if (event.candidate) this.send({ type: 'ice', candidate: event.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      if (pc.connectionState === 'connected') this.opts.onState('connected');
      else if (pc.connectionState === 'connecting' || pc.connectionState === 'new') this.opts.onState('connecting');
      else if (pc.connectionState === 'disconnected') this.opts.onState('reconnecting');
      else if (pc.connectionState === 'failed') this.opts.onState('failed');
    };
    this.pc = pc;
    return pc;
  }

  private async makeOffer() {
    if (this.closed || this.opts.role !== 'host') return;
    const pc = this.newPeer();
    this.opts.onState('connecting');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: 'offer', sdp: offer });
  }

  private async handle(signal: Signal) {
    if (this.closed) return;
    if (signal.type === 'hello' && this.opts.role === 'host') {
      await this.makeOffer();
    } else if (signal.type === 'offer' && this.opts.role === 'guest') {
      const pc = this.newPeer();
      this.opts.onState('connecting');
      await pc.setRemoteDescription(signal.sdp);
      await this.flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ type: 'answer', sdp: answer });
    } else if (signal.type === 'answer' && this.opts.role === 'host' && this.pc) {
      if (this.pc.signalingState === 'have-local-offer') {
        await this.pc.setRemoteDescription(signal.sdp);
        await this.flushIce();
      }
    } else if (signal.type === 'ice') {
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(signal.candidate).catch(() => undefined);
      else this.pendingIce.push(signal.candidate);
    } else if (signal.type === 'end') {
      void this.hangUp(false).then(() => this.opts.onEnded?.());
    } else if (signal.type === 'bye') {
      this.opts.onRemoteStream(null);
      this.opts.onState('reconnecting');
      this.opts.onPeerLeft?.();
    }
  }

  private async flushIce() {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of queued) await this.pc?.addIceCandidate(candidate).catch(() => undefined);
  }

  setAudio(enabled: boolean) {
    this.local?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
  }

  setVideo(enabled: boolean) {
    this.local?.getVideoTracks().forEach((track) => { track.enabled = enabled; });
  }

  /** Swaps the outgoing camera for a screen share; resolves when sharing stops. */
  async shareScreen(onStop: () => void) {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
    this.screen = display;
    const track = display.getVideoTracks()[0];
    const sender = this.pc?.getSenders().find((item) => item.track?.kind === 'video');
    if (sender && track) await sender.replaceTrack(track);
    track.onended = () => void this.stopScreen().then(onStop);
  }

  async stopScreen() {
    const camera = this.local?.getVideoTracks()[0];
    const sender = this.pc?.getSenders().find((item) => item.track?.kind === 'video');
    if (sender && camera) await sender.replaceTrack(camera);
    this.screen?.getTracks().forEach((track) => track.stop());
    this.screen = null;
  }

  /** Leaves the room. `endForEveryone` (host) closes the visit on the other side too; otherwise they see "left". */
  async hangUp(endForEveryone = false) {
    if (this.closed) return;
    this.send({ type: endForEveryone ? 'end' : 'bye' });
    this.closed = true;
    this.screen?.getTracks().forEach((track) => track.stop());
    this.pc?.close();
    this.pc = null;
    if (this.channel) {
      await this.channel.untrack().catch(() => undefined);
      await requireSupabase().removeChannel(this.channel);
      this.channel = null;
    }
    this.opts.onRemoteStream(null);
    this.opts.onState('ended');
  }
}

export interface LocalMedia {
  stream: MediaStream;
  /** Set when we fell back from camera + microphone. */
  note: string;
}

/**
 * Camera + microphone, falling back to microphone only and then to
 * listen-only (empty stream) so a missing or blocked device never stops a visit.
 */
export async function openCameraAndMic(): Promise<LocalMedia> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: new MediaStream(), note: 'This browser cannot use a camera or microphone; you can still see and hear the other side.' };
  }
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }), note: '' };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      return { stream: audio, note: name === 'NotAllowedError' ? 'Camera blocked: joining with audio only.' : 'No camera found: joining with audio only.' };
    } catch {
      return {
        stream: new MediaStream(),
        note: name === 'NotAllowedError'
          ? 'Camera and microphone are blocked. Allow them in the address bar to be seen and heard; you can still see and hear the other side.'
          : 'No camera or microphone found; you can still see and hear the other side.',
      };
    }
  }
}
