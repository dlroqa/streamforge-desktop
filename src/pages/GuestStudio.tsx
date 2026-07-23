import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { resolveGuestInvite, type GuestAccessResponse } from '@/lib/streamApi';
import { useDailyGuest } from '@/hooks/useDailyGuest';
import { useAudioLevel } from '@/hooks/useAudioLevel';
import { SlideshowController, deckTitleFromName, type SlideshowMeta } from '@/lib/slideshow';
import { ControlButton } from '@/components/studio/ControlButton';
import { ForgeChatView } from '@/components/studio/ForgeChatView';
import { ForgeChatSoundControls } from '@/components/studio/ForgeChatSoundControls';
import { playForgeChime, evaluateChime } from '@/lib/notificationSound';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Radio, Mic, MicOff, Video, VideoOff, Monitor, Presentation, ChevronLeft, ChevronRight,
  Loader2, PhoneOff, VideoIcon, MessageSquare, Pencil,
} from 'lucide-react';
import { StageLayoutRail } from '@/components/studio/StageLayoutRail';

/** How the guest arranges their own stage tiles locally (mirrors the host's
 * scene layout — a personal view preference, it doesn't touch the broadcast). */
type StageLayout = 'split' | 'pip' | 'solo';

// ── Small building blocks ───────────────────────────────────────────────────

/** Attaches a MediaStreamTrack to a <video>. `fit` is 'cover' for cameras and
 * 'contain' for screen/slide shares so shared content is never cropped. */
function VideoTile({ track, label, muted, fit = 'cover', fallbackInitial, onRename, nameValue }: {
  track: MediaStreamTrack | null;
  label: string;
  muted: boolean;
  fit?: 'cover' | 'contain';
  fallbackInitial?: string;
  /** When set, the label is click-to-edit and saving calls this (used for the
   * guest's own tile, so they can rename live). */
  onRename?: (name: string) => void;
  /** Current name to prefill the rename input with. */
  nameValue?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play().catch(() => { /* autoplay after gesture */ });
    return () => { el.srcObject = null; };
  }, [track]);

  const commit = () => {
    const v = draft.trim();
    if (v && onRename) onRename(v);
    setEditing(false);
  };

  return (
    <div className="relative bg-card rounded-xl overflow-hidden border border-border aspect-video">
      {track ? (
        <video
          ref={videoRef}
          autoPlay
          muted={muted}
          playsInline
          className={`w-full h-full ${fit === 'contain' ? 'object-contain bg-black' : 'object-cover'}`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="h-16 w-16 rounded-full bg-primary/90 flex items-center justify-center text-2xl font-bold text-primary-foreground">
            {(fallbackInitial || 'G').toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 text-white text-xs font-medium">
        {onRename ? (
          editing ? (
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                else if (e.key === 'Escape') { setEditing(false); }
              }}
              maxLength={40}
              placeholder="Your name"
              className="w-32 bg-black/70 rounded px-1.5 py-1 outline-none ring-1 ring-primary/60 placeholder:text-white/50"
            />
          ) : (
            <button
              onClick={() => { setDraft(nameValue ?? ''); setEditing(true); }}
              className="flex items-center gap-1 bg-black/55 hover:bg-black/70 px-2 py-1 rounded transition-colors"
              title="Edit your display name"
            >
              {label}
              <Pencil className="h-3 w-3 opacity-70" />
            </button>
          )
        ) : (
          <span className="bg-black/55 px-2 py-1 rounded inline-block">{label}</span>
        )}
      </div>
    </div>
  );
}

/** Hidden sink so the guest hears remote participants (host + co-guests). */
function RemoteAudio({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = new MediaStream([track]);
    el.play().catch(() => { /* allowed after join gesture */ });
    return () => { el.srcObject = null; };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

// ── Chrome (matches the host studio's look) ─────────────────────────────────

function GuestHeader({ hostName, live }: { hostName: string; live: boolean }) {
  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-5 shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Radio className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-foreground tracking-tight text-lg">StreamForge</span>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Guest of <span className="text-foreground font-medium">{hostName}</span>
        </span>
        {live && (
          <div className="flex items-center gap-2 ml-1">
            <span className="h-2 w-2 rounded-full bg-live animate-pulse-live" />
            <span className="text-xs font-mono font-bold text-live tracking-wider">LIVE</span>
          </div>
        )}
      </div>
      <a
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
        title="Create your own stream on StreamForge"
      >
        Start your own stream →
      </a>
    </header>
  );
}

function GuestControlBar({
  isMicOn, isCameraOn, isScreenSharing, isPresenting, chatOpen, unreadChat,
  onToggleMic, onToggleCamera, onPresent, onToggleScreen, onToggleChat, onLeave,
}: {
  isMicOn: boolean; isCameraOn: boolean; isScreenSharing: boolean; isPresenting: boolean;
  chatOpen: boolean; unreadChat: number;
  onToggleMic: () => void; onToggleCamera: () => void;
  onPresent: () => void; onToggleScreen: () => void; onToggleChat: () => void; onLeave: () => void;
}) {
  return (
    <div className="h-16 border-t border-border bg-card flex items-center justify-center gap-2 px-4 shrink-0">
      <ControlButton onClick={onToggleMic} active={isMicOn} label={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}>
        {isMicOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
      </ControlButton>
      <ControlButton onClick={onToggleCamera} active={isCameraOn} label={isCameraOn ? 'Stop Camera' : 'Start Camera'}>
        {isCameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
      </ControlButton>
      <ControlButton
        onClick={onPresent}
        active={isPresenting ? true : undefined}
        label={isPresenting ? 'End Slideshow · back to camera' : 'Present Slides'}
      >
        <Presentation className="h-5 w-5" />
      </ControlButton>
      <ControlButton
        onClick={onToggleScreen}
        active={isScreenSharing && !isPresenting ? true : undefined}
        label={isScreenSharing && !isPresenting ? 'Stop Screen Share' : 'Share Screen'}
      >
        <Monitor className="h-5 w-5" />
      </ControlButton>
      <div className="relative">
        <ControlButton
          onClick={onToggleChat}
          active={chatOpen ? true : undefined}
          label={unreadChat > 0 && !chatOpen ? 'Forge Chat · new message' : 'Forge Chat'}
        >
          <MessageSquare className="h-5 w-5" />
        </ControlButton>
        {unreadChat > 0 && !chatOpen && (
          <>
            {/* Blinking ring + count to grab attention until read */}
            <span className="absolute inset-0 rounded-xl ring-2 ring-live animate-pulse-live pointer-events-none" />
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-live text-live-foreground text-[10px] font-bold flex items-center justify-center animate-pulse-live">
              {unreadChat > 9 ? '9+' : unreadChat}
            </span>
          </>
        )}
      </div>
      <div className="w-px h-8 bg-border mx-1" />
      <ControlButton onClick={onLeave} danger active label="Leave the stream">
        <PhoneOff className="h-5 w-5" />
      </ControlButton>
    </div>
  );
}

// ── Full-screen status states ───────────────────────────────────────────────

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GuestHeaderShell />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">{children}</div>
      </div>
    </div>
  );
}

function GuestHeaderShell() {
  return (
    <header className="h-14 border-b border-border bg-card flex items-center px-5 shrink-0">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <Radio className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-bold text-foreground tracking-tight text-lg">StreamForge</span>
      </div>
    </header>
  );
}

// ── Green room (device check before joining) ────────────────────────────────

function GreenRoom({
  invite, joining, onJoin,
}: {
  invite: GuestAccessResponse;
  joining: boolean;
  onJoin: (opts: { name: string; videoDeviceId?: string; audioDeviceId?: string }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [name, setName] = useState(invite.guest_name || '');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState<string>('');
  const [audioDeviceId, setAudioDeviceId] = useState<string>('');
  const [permError, setPermError] = useState<string | null>(null);
  // Live preview stream in state (not just the ref) so the mic-level meter can
  // subscribe to it and confirm the microphone is actually picking up audio.
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const micLevel = useAudioLevel(previewStream);

  // Acquire a preview stream for the chosen camera/mic and enumerate devices.
  const openPreview = useCallback(async (vId?: string, aId?: string) => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: vId ? { deviceId: { exact: vId } } : true,
        audio: aId ? { deviceId: { exact: aId } } : true,
      });
      streamRef.current = stream;
      setPreviewStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => { /* autoplay */ });
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
      setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
      const activeV = stream.getVideoTracks()[0]?.getSettings().deviceId;
      const activeA = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (activeV) setVideoDeviceId(activeV);
      if (activeA) setAudioDeviceId(activeA);
      setPermError(null);
    } catch {
      setPermError('We need access to your camera and microphone to join. Please allow access and try again.');
    }
  }, []);

  useEffect(() => {
    openPreview();
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [openPreview]);

  const handleJoin = () => {
    // Release the preview so Daily can open the same devices cleanly.
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setPreviewStream(null);
    onJoin({ name: name.trim() || 'Guest', videoDeviceId, audioDeviceId });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GuestHeader hostName={invite.host_name || 'the host'} live={invite.status === 'live'} />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl grid md:grid-cols-2 gap-6 items-center">
          {/* Camera preview */}
          <div className="relative bg-card rounded-2xl overflow-hidden border border-border aspect-video shadow-xl">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            {permError && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center bg-card">
                <p className="text-sm text-muted-foreground">{permError}</p>
              </div>
            )}
          </div>

          {/* Setup */}
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {invite.status === 'live' ? "You're invited — the show is live" : 'Ready to join'}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {invite.host_name || 'The host'} invited you to join
                {invite.stream_title ? ` “${invite.stream_title}”` : ' their stream'}. Check your
                camera and mic, then join.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Your name</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={40} />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <VideoIcon className="h-3.5 w-3.5" /> Camera
                </label>
                <Select value={videoDeviceId} onValueChange={(v) => { setVideoDeviceId(v); openPreview(v, audioDeviceId); }}>
                  <SelectTrigger><SelectValue placeholder="Default camera" /></SelectTrigger>
                  <SelectContent>
                    {videoDevices.map(d => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Mic className="h-3.5 w-3.5" /> Microphone
                </label>
                <Select value={audioDeviceId} onValueChange={(v) => { setAudioDeviceId(v); openPreview(videoDeviceId, v); }}>
                  <SelectTrigger><SelectValue placeholder="Default microphone" /></SelectTrigger>
                  <SelectContent>
                    {audioDevices.map(d => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Live input level so the guest can confirm their mic works. */}
                <div className="flex items-center gap-2 pt-0.5">
                  <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-75"
                      style={{ width: `${Math.min(100, micLevel)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground w-16 shrink-0">
                    {micLevel > 4 ? 'Mic OK' : 'Say something'}
                  </span>
                </div>
              </div>
            </div>

            <Button
              onClick={handleJoin}
              disabled={joining || !!permError}
              className="w-full gap-2 font-semibold"
              size="lg"
            >
              {joining ? <><Loader2 className="h-4 w-4 animate-spin" /> Joining…</> : 'Join the stream'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function GuestStudio() {
  const { inviteToken } = useParams<{ inviteToken: string }>();
  const { toast } = useToast();
  const [invite, setInvite] = useState<GuestAccessResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);

  const {
    status, phase, participants, isCameraOn, isMicOn, isScreenSharing,
    forgeChat, sendForgeChat, brief,
    join, leave, setCamera, setMic, setUserName, startScreenShare, stopScreenShare,
  } = useDailyGuest();

  // Forge Chat drawer + unread badge.
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const lastChatCountRef = useRef(0);
  useEffect(() => {
    if (chatOpen) {
      setUnreadChat(0);
      lastChatCountRef.current = forgeChat.length;
      return;
    }
    const incoming = forgeChat.slice(lastChatCountRef.current).filter(m => !m.mine).length;
    if (incoming) setUnreadChat(u => u + incoming);
    lastChatCountRef.current = forgeChat.length;
  }, [forgeChat, chatOpen]);

  // Stage arrangement (Split / PiP / Solo) — a local view preference, persisted.
  const [stageLayout, setStageLayout] = useState<StageLayout>(() => {
    try {
      const raw = localStorage.getItem('guest-stage-layout');
      return raw === 'pip' || raw === 'solo' || raw === 'split' ? raw : 'split';
    } catch { return 'split'; }
  });
  const changeStageLayout = useCallback((v: StageLayout) => {
    setStageLayout(v);
    try { localStorage.setItem('guest-stage-layout', v); } catch { /* quota */ }
  }, []);

  // New-message chime for the Forge Chat — same sound the host hears, with a
  // mute/volume the guest controls. Both persisted; read through refs so
  // changing them never re-fires the sound.
  const [soundMuted, setSoundMuted] = useState<boolean>(() => {
    try { return localStorage.getItem('guest-forge-sound-muted') === '1'; } catch { return false; }
  });
  const [soundVolume, setSoundVolume] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('guest-forge-sound-volume');
      const n = raw == null ? 70 : parseInt(raw, 10);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 70;
    } catch { return 70; }
  });
  const toggleSound = useCallback(() => {
    setSoundMuted(prev => {
      const next = !prev;
      try { localStorage.setItem('guest-forge-sound-muted', next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  }, []);
  const changeSoundVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    setSoundVolume(clamped);
    try { localStorage.setItem('guest-forge-sound-volume', String(clamped)); } catch { /* quota */ }
  }, []);

  const soundSeenRef = useRef<number | null>(null);
  const soundMutedRef = useRef(soundMuted);
  soundMutedRef.current = soundMuted;
  const soundVolumeRef = useRef(soundVolume);
  soundVolumeRef.current = soundVolume;
  useEffect(() => {
    const { chime, nextSeen } = evaluateChime(soundSeenRef.current, forgeChat);
    soundSeenRef.current = nextSeen;
    if (chime && !soundMutedRef.current) playForgeChime(soundVolumeRef.current);
  }, [forgeChat]);

  // Slideshow (rides the same Daily screen channel as Share Screen).
  const slideCtrlRef = useRef<SlideshowController | null>(null);
  const slideInputRef = useRef<HTMLInputElement>(null);
  const [slideMeta, setSlideMeta] = useState<SlideshowMeta | null>(null);
  const isPresenting = slideMeta !== null;
  // Last slide shown per deck, so re-presenting resumes where it left off.
  const slideResumeRef = useRef<Map<string, number>>(new Map());
  const rememberSlidePosition = useCallback(() => {
    const ctrl = slideCtrlRef.current;
    if (ctrl) slideResumeRef.current.set(ctrl.title, ctrl.meta.current);
  }, []);

  const closeSlides = useCallback(() => {
    rememberSlidePosition();
    slideCtrlRef.current?.dispose();
    slideCtrlRef.current = null;
    setSlideMeta(null);
    stopScreenShare();
  }, [stopScreenShare, rememberSlidePosition]);

  const handleSlideFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (slideInputRef.current) slideInputRef.current.value = '';
    if (!file) return;
    try {
      slideCtrlRef.current?.dispose();
      const startPage = slideResumeRef.current.get(deckTitleFromName(file.name)) ?? 1;
      const ctrl = await SlideshowController.load(file, m => setSlideMeta(m), startPage);
      slideCtrlRef.current = ctrl;
      setSlideMeta(ctrl.meta);
      startScreenShare(ctrl.stream); // publish the slide canvas as our screen
    } catch (err) {
      slideCtrlRef.current = null;
      setSlideMeta(null);
      toast({ title: 'Couldn’t open slideshow', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handlePresent = () => {
    if (isPresenting) {
      closeSlides();
      // Return to the video source: re-enable the camera if it was off so the
      // tile shows the guest again rather than a blank frame.
      if (!isCameraOn) setCamera(true);
    } else {
      slideInputRef.current?.click();
    }
  };

  const handleToggleScreen = () => {
    if (isScreenSharing && !isPresenting) {
      stopScreenShare();
    } else if (isPresenting) {
      // Switch from slides to a live screen share (single screen channel).
      rememberSlidePosition();
      slideCtrlRef.current?.dispose();
      slideCtrlRef.current = null;
      setSlideMeta(null);
      stopScreenShare();
      setTimeout(() => startScreenShare(), 300);
    } else {
      startScreenShare();
    }
  };

  // Arrow keys navigate slides while presenting.
  useEffect(() => {
    if (!isPresenting) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); slideCtrlRef.current?.next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); slideCtrlRef.current?.prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPresenting]);

  // Tidy up the slideshow if the component unmounts mid-presentation.
  useEffect(() => () => { slideCtrlRef.current?.dispose(); slideCtrlRef.current = null; }, []);

  // Resolve the invite once.
  useEffect(() => {
    let active = true;
    if (!inviteToken) { setLoadError('This invite link is missing its code.'); return; }
    resolveGuestInvite(inviteToken).then(res => {
      if (!active) return;
      if (!res.success) setLoadError(res.error || 'This invite link is not valid.');
      else setInvite(res);
    });
    return () => { active = false; };
  }, [inviteToken]);

  const handleJoin = async (opts: { name: string; videoDeviceId?: string; audioDeviceId?: string }) => {
    if (!invite?.room_url || !invite.daily_token) {
      setLoadError('This stream is no longer available.');
      return;
    }
    setJoining(true);
    try {
      await join(invite.room_url, invite.daily_token, {
        userName: opts.name,
        videoDeviceId: opts.videoDeviceId,
        audioDeviceId: opts.audioDeviceId,
        initialLive: invite.status === 'live',
      });
      setJoined(true);
    } catch {
      setLoadError('Could not connect to the stream. Please try again.');
    } finally {
      setJoining(false);
    }
  };

  // ── Render states ──
  if (loadError) {
    return (
      <CenteredState>
        <h1 className="text-xl font-bold text-foreground">Can’t join this stream</h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button asChild variant="outline"><a href="/">Go to StreamForge</a></Button>
      </CenteredState>
    );
  }

  if (!invite) {
    return (
      <CenteredState>
        <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
        <p className="text-sm text-muted-foreground">Loading your invite…</p>
      </CenteredState>
    );
  }

  if (invite.status === 'ended' && !joined) {
    return (
      <CenteredState>
        <h1 className="text-xl font-bold text-foreground">This stream has ended</h1>
        <p className="text-sm text-muted-foreground">
          The broadcast you were invited to is no longer live.
        </p>
        <Button asChild variant="outline"><a href="/">Explore StreamForge</a></Button>
      </CenteredState>
    );
  }

  // Ejected / stream ended while connected
  if (joined && phase === 'ended') {
    return (
      <CenteredState>
        <h1 className="text-xl font-bold text-foreground">You’ve left the stream</h1>
        <p className="text-sm text-muted-foreground">The broadcast ended or you were removed by the host.</p>
        <Button asChild><a href="/">Start your own stream</a></Button>
      </CenteredState>
    );
  }

  if (!joined) {
    return <GreenRoom invite={invite} joining={joining} onJoin={handleJoin} />;
  }

  // Live studio: header + participant stage + control bar.
  // Video stage shows the host + the guest (self) + any co-guests. The host
  // publishes its raw camera as a custom track (see useDailyGuest), so its tile
  // shows the host's face alone — not the program composite. Ordered host
  // first, then you, then co-guests.
  const stageParticipants = [...participants].sort((a, b) => {
    const rank = (p: typeof a) => (p.owner ? 0 : p.local ? 1 : 2);
    return rank(a) - rank(b);
  });
  // Prefer the host's LIVE Daily participant name (updates in real time when the
  // host renames in Account settings), falling back to the invite-time value.
  const liveHostName = participants.find(p => p.owner)?.userName?.trim();
  const hostName = liveHostName || invite.host_name || 'Host';
  // The guest's own current name (for the click-to-edit 'You' tile label).
  const myName = participants.find(p => p.local)?.userName?.trim() ?? '';
  // Each participant contributes a camera tile, plus a screen tile when they're
  // sharing/presenting — so the guest sees their own shared content in a split.
  type Tile = {
    key: string; track: MediaStreamTrack | null; label: string;
    muted: boolean; fit: 'cover' | 'contain'; fallbackInitial?: string;
    local: boolean; owner: boolean; kind: 'cam' | 'screen';
  };
  const stageItems: Tile[] = stageParticipants.flatMap(p => {
    // The host tile shows the host's raw camera (falling back to the program
    // composite only if that custom track isn't available). Labeled with the
    // host's name either way.
    const camLabel = p.owner ? hostName : p.local ? 'You' : p.userName;
    const items: Tile[] = [{
      key: `${p.sessionId}:cam`,
      track: p.videoTrack,
      label: camLabel,
      muted: p.local,
      fit: 'cover',
      fallbackInitial: (p.owner ? hostName : p.userName)[0],
      local: p.local,
      owner: p.owner,
      kind: 'cam',
    }];
    if (p.screenTrack) {
      items.push({
        key: `${p.sessionId}:screen`,
        track: p.screenTrack,
        label: p.local ? (isPresenting ? 'Your slides' : 'Your screen') : `${p.owner ? hostName : p.userName}'s screen`,
        muted: true,
        fit: 'contain',
        fallbackInitial: (p.owner ? hostName : p.userName)[0],
        local: p.local,
        owner: p.owner,
        kind: 'screen',
      });
    }
    return items;
  });
  // Primary source for the PiP/Solo arrangements:
  //  • presenting  → the guest's own shared content leads (both modes)
  //  • PiP         → the HOST is featured large, the guest sits in the inset
  //  • Solo        → just the guest's own camera (others stay audible)
  const primaryIndex = Math.max(0,
    (() => {
      const localScreen = stageItems.findIndex(t => t.local && t.kind === 'screen');
      if (localScreen >= 0) return localScreen;
      if (stageLayout === 'pip') {
        const host = stageItems.findIndex(t => t.owner);
        if (host >= 0) return host;
      }
      return stageItems.findIndex(t => t.local && t.kind === 'cam');
    })(),
  );
  const primaryTile = stageItems[primaryIndex];
  const otherTiles = stageItems.filter((_, i) => i !== primaryIndex);
  // Only the guest's OWN camera tile is click-to-edit (rename yourself live).
  const editProps = (it: Tile) => it.local && it.kind === 'cam'
    ? { onRename: setUserName, nameValue: myName }
    : {};
  // Keep ALL remote audio (incl. the host) so the guest still hears the host.
  const remoteAudio = participants.filter(p => !p.local && p.audioTrack);
  const connecting = status === 'connecting';

  return (
    <div className="min-h-screen h-screen bg-background flex flex-col overflow-hidden">
      <GuestHeader hostName={hostName} live={phase === 'live'} />

      <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 relative bg-muted/20 overflow-hidden flex flex-col items-center justify-center p-4 gap-4">
        {phase === 'waiting' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-card/90 border border-border rounded-full px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Waiting room — prepping with {invite.host_name || 'the host'}. Not live yet.
          </div>
        )}

        {/* Shared topic/agenda the host wrote — visible while prepping. */}
        {phase !== 'live' && brief.trim() && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 w-full max-w-md bg-card/95 border border-border rounded-xl px-4 py-3 shadow-lg">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Presentation className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Topic / agenda</span>
            </div>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">{brief}</p>
          </div>
        )}
        {phase === 'live' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-live/15 text-live border border-live/30 rounded-full px-4 py-1.5 text-xs font-semibold flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-live animate-pulse-live" />
            You’re live
          </div>
        )}

        {connecting ? (
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        ) : stageLayout === 'split' || stageItems.length <= 1 ? (
          <div className={`w-full max-w-5xl grid gap-4 ${stageItems.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
            {stageItems.map(it => (
              <VideoTile
                key={it.key}
                track={it.track}
                label={it.label}
                muted={it.muted}
                fit={it.fit}
                fallbackInitial={it.fallbackInitial}
                {...editProps(it)}
              />
            ))}
          </div>
        ) : (
          // PiP: main source large with the rest as insets. Solo: main only
          // (the others stay audible through the hidden audio sinks below).
          <div className="relative w-full max-w-5xl">
            {primaryTile && (
              <VideoTile
                key={primaryTile.key}
                track={primaryTile.track}
                label={primaryTile.label}
                muted={primaryTile.muted}
                fit={primaryTile.fit}
                fallbackInitial={primaryTile.fallbackInitial}
                {...editProps(primaryTile)}
              />
            )}
            {stageLayout === 'pip' && otherTiles.length > 0 && (
              <div className="absolute bottom-3 right-3 flex flex-col gap-2 w-28 sm:w-40">
                {otherTiles.map(it => (
                  <div key={it.key} className="shadow-lg rounded-xl ring-1 ring-black/20">
                    <VideoTile
                      track={it.track}
                      label={it.label}
                      muted={it.muted}
                      fit={it.fit}
                      fallbackInitial={it.fallbackInitial}
                      {...editProps(it)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Split / PiP / Solo rail — arranges the guest's own view, on the
            right edge of the video (doesn't affect the broadcast). */}
        {!connecting && <StageLayoutRail value={stageLayout} onChange={changeStageLayout} />}

        {/* Presenting / sharing indicator */}
        {(isScreenSharing || isPresenting) && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-card/95 border border-border rounded-full pl-4 pr-2 py-1.5 text-xs text-foreground flex items-center gap-3 shadow-lg">
            {isPresenting && slideMeta ? (
              <>
                <span className="flex items-center gap-1.5">
                  <Presentation className="h-3.5 w-3.5 text-primary" />
                  Slide {slideMeta.current}/{slideMeta.total}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => slideCtrlRef.current?.prev()} className="p-1 rounded hover:bg-secondary" title="Previous (←)">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button onClick={() => slideCtrlRef.current?.next()} className="p-1 rounded hover:bg-secondary" title="Next (→)">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </>
            ) : (
              <span className="flex items-center gap-1.5 pr-1">
                <Monitor className="h-3.5 w-3.5 text-primary" />
                Sharing your screen
              </span>
            )}
          </div>
        )}

        {/* Hidden audio sinks for remote participants */}
        <div className="hidden">
          {remoteAudio.map(p => <RemoteAudio key={p.sessionId} track={p.audioTrack!} />)}
        </div>
      </div>

      {/* Forge Chat side panel — private backstage chat with the host */}
      {chatOpen && (
        <div className="w-80 border-l border-border bg-card flex flex-col shrink-0">
          <ForgeChatView
            messages={forgeChat}
            onSend={sendForgeChat}
            subtitle={`with ${invite.host_name || 'the host'}`}
            emptyHint="Private chat with the host — viewers never see this."
            headerAction={
              <ForgeChatSoundControls
                muted={soundMuted}
                volume={soundVolume}
                onToggle={toggleSound}
                onVolumeChange={changeSoundVolume}
                description="Chime when the host sends you a Forge Chat message."
              />
            }
          />
        </div>
      )}
      </div>

      <input
        ref={slideInputRef}
        type="file"
        accept=".pdf,application/pdf,image/*,.pptx,.ppt,.pps,.ppsx,.key,.odp"
        onChange={handleSlideFile}
        className="hidden"
      />

      <GuestControlBar
        isMicOn={isMicOn}
        isCameraOn={isCameraOn}
        isScreenSharing={isScreenSharing}
        isPresenting={isPresenting}
        chatOpen={chatOpen}
        unreadChat={unreadChat}
        onToggleMic={() => setMic(!isMicOn)}
        onToggleCamera={() => setCamera(!isCameraOn)}
        onPresent={handlePresent}
        onToggleScreen={handleToggleScreen}
        onToggleChat={() => setChatOpen(o => !o)}
        onLeave={() => { leave().then(() => { window.location.href = '/'; }); }}
      />
    </div>
  );
}
