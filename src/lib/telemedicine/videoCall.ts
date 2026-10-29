// One-to-one video call over WebRTC. Media goes browser-to-browser (encrypted
// by WebRTC); a Supabase Realtime broadcast channel named after the session's
// random room token carries only the offer/answer/ICE messages.
//
// The host (clinician who admits) makes the offer once the guest is present;
// the guest answers. If either side reloads, presence brings them back
// together and the host renegotiates.
//
// Built for weak connections: video starts at 360p (180p in low-data mode), and every few seconds
// the call checks packet loss, delay and the bandwidth available, lowering resolution, frame rate
// and bitrate when the line struggles and raising them again when it recovers. On a very weak link
// it stops sending video by itself (audio only) so the conversation stays clear.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '@/lib/supabase/client';

export type CallRole = 'host' | 'guest';
export type CallState = 'idle' | 'waiting-for-peer' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';
export type CallQuality = 'good' | 'fair' | 'poor';

// Outgoing video per connection level (bitrate in bits per second).
const VIDEO_PROFILES: Record<CallQuality, { maxBitrate: number; scaleResolutionDownBy: number; maxFramerate: number }> = {
  good: { maxBitrate: 700_000, scaleResolutionDownBy: 1, maxFramerate: 24 },
  fair: { maxBitrate: 250_000, scaleResolutionDownBy: 1.5, maxFramerate: 15 },
  poor: { maxBitrate: 100_000, scaleResolutionDownBy: 2, maxFramerate: 10 },
};
const AUDIO_POOR_BITRATE = 16_000;
const CHECK_EVERY_MS = 4000;

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
  /** Start as if the connection were weak (low-data mode). */
  lowData?: boolean;
  /** Connection level, and whether video is paused to keep audio clear. */
  onQuality?: (quality: CallQuality, audioOnly: boolean) => void;
}

export class VideoCall {
  private pc: RTCPeerConnection | null = null;
  private channel: RealtimeChannel | null = null;
  private local: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private closed = false;
  private readonly opts: VideoCallOptions;
  private monitor = 0;
  private quality: CallQuality = 'good';
  private poorChecks = 0;
  private goodChecks = 0;
  private autoAudioOnly = false;
  private manualAudioOnly = false;
  private lastInbound: { lost: number; received: number } | null = null;

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
      if (pc.connectionState === 'connected') { this.opts.onState('connected'); this.startMonitor(); }
      else if (pc.connectionState === 'connecting' || pc.connectionState === 'new') this.opts.onState('connecting');
      else if (pc.connectionState === 'disconnected') this.opts.onState('reconnecting');
      else if (pc.connectionState === 'failed') this.opts.onState('failed');
    };
    this.pc = pc;
    return pc;
  }

  // ---------- adapting to the connection ----------

  private startMonitor() {
    window.clearInterval(this.monitor);
    this.lastInbound = null;
    this.setQuality(this.opts.lowData ? 'fair' : 'good');
    this.monitor = window.setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  private async check() {
    const pc = this.pc;
    if (!pc || this.closed || pc.connectionState !== 'connected') return;
    let rtt = 0;
    let available = 0;
    let lossOut = 0;
    let lost = 0;
    let received = 0;
    const stats = await pc.getStats().catch(() => null);
    stats?.forEach((report) => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
        rtt = report.currentRoundTripTime ?? rtt;
        available = report.availableOutgoingBitrate ?? available;
      } else if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
        lossOut = Math.max(lossOut, report.fractionLost ?? 0);
      } else if (report.type === 'inbound-rtp' && report.kind === 'video') {
        lost += report.packetsLost ?? 0;
        received += report.packetsReceived ?? 0;
      }
    });
    // Loss on what we receive, since the last check.
    let lossIn = 0;
    if (this.lastInbound) {
      const newLost = lost - this.lastInbound.lost;
      const newReceived = received - this.lastInbound.received;
      if (newLost + newReceived > 0) lossIn = Math.max(0, newLost) / (Math.max(0, newLost) + Math.max(0, newReceived));
    }
    this.lastInbound = { lost, received };
    const loss = Math.max(lossOut, lossIn);

    const level: CallQuality = loss > 0.1 || rtt > 1 || (available > 0 && available < 150_000) ? 'poor'
      : loss > 0.03 || rtt > 0.4 || (available > 0 && available < 500_000) ? 'fair' : 'good';
    this.poorChecks = level === 'poor' ? this.poorChecks + 1 : 0;
    this.goodChecks = level === 'good' ? this.goodChecks + 1 : 0;

    // Video off by itself after ~12 s of a very weak link; back on after ~12 s of a good one.
    if (!this.autoAudioOnly && this.poorChecks >= 3 && (available === 0 || available < 90_000 || loss > 0.15)) this.autoAudioOnly = true;
    else if (this.autoAudioOnly && this.goodChecks >= 3) this.autoAudioOnly = false;

    // Low-data mode never goes above "fair".
    this.setQuality(this.opts.lowData && level === 'good' ? 'fair' : level);
  }

  private setQuality(level: CallQuality) {
    this.quality = level;
    void this.applyEncodings();
    this.opts.onQuality?.(level, this.audioOnly);
  }

  private get audioOnly() {
    return this.manualAudioOnly || this.autoAudioOnly;
  }

  private async applyEncodings() {
    const pc = this.pc;
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      if (!sender.track) continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      const encoding = params.encodings[0];
      if (sender.track.kind === 'video') {
        const profile = VIDEO_PROFILES[this.quality];
        encoding.maxBitrate = profile.maxBitrate;
        encoding.maxFramerate = profile.maxFramerate;
        // A shared screen keeps its full resolution so text stays readable.
        encoding.scaleResolutionDownBy = this.screen ? 1 : profile.scaleResolutionDownBy;
        encoding.active = !this.audioOnly;
      } else if (sender.track.kind === 'audio') {
        if (this.quality === 'poor') encoding.maxBitrate = AUDIO_POOR_BITRATE;
        else delete encoding.maxBitrate;
      }
      await sender.setParameters(params).catch(() => undefined);
    }
  }

  /** Stops (or resumes) sending video to save data; the other side's video still plays. */
  setAudioOnly(on: boolean) {
    this.manualAudioOnly = on;
    if (!on) this.autoAudioOnly = false;
    void this.applyEncodings();
    this.opts.onQuality?.(this.quality, this.audioOnly);
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
    // A low frame rate is plenty for documents and results, and keeps the bitrate down.
    const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } } });
    this.screen = display;
    const track = display.getVideoTracks()[0];
    if (track) track.contentHint = 'detail';
    const sender = this.pc?.getSenders().find((item) => item.track?.kind === 'video');
    if (sender && track) await sender.replaceTrack(track);
    void this.applyEncodings();
    track.onended = () => void this.stopScreen().then(onStop);
  }

  async stopScreen() {
    const camera = this.local?.getVideoTracks()[0];
    const sender = this.pc?.getSenders().find((item) => item.track?.kind === 'video');
    if (sender && camera) await sender.replaceTrack(camera);
    this.screen?.getTracks().forEach((track) => track.stop());
    this.screen = null;
    void this.applyEncodings();
  }

  /** Leaves the room. `endForEveryone` (host) closes the visit on the other side too; otherwise they see "left". */
  async hangUp(endForEveryone = false) {
    if (this.closed) return;
    this.send({ type: endForEveryone ? 'end' : 'bye' });
    this.closed = true;
    window.clearInterval(this.monitor);
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
 * 360p is plenty for a consultation; low-data mode asks for 180p at a lower frame rate.
 */
export async function openCameraAndMic(lowData = false): Promise<LocalMedia> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: new MediaStream(), note: 'This browser cannot use a camera or microphone; you can still see and hear the other side.' };
  }
  try {
    const video = lowData
      ? { width: { ideal: 320 }, height: { ideal: 180 }, frameRate: { ideal: 12, max: 15 } }
      : { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } };
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    return { stream: await navigator.mediaDevices.getUserMedia({ video, audio }), note: '' };
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
