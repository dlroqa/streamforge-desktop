import { useState, useRef, useCallback, useEffect } from 'react';
import {
  FORGE_CHAT_TYPE, FORGE_CHAT_MAX, isForgeChatWire,
  type ForgeChatMessage, type ForgeChatWire,
} from '@/lib/forgeChat';
import { isBackstageBriefWire } from '@/lib/backstageBrief';

export type GuestStatus = 'idle' | 'connecting' | 'joined' | 'error';
/** Where the guest is in the flow:
 * - green-room: previewing devices locally, not yet joined
 * - waiting:    in the room, host hasn't started the broadcast yet
 * - live:       the host is broadcasting (RTMP live-streaming started)
 * - ended:      the stream ended or the guest was removed */
export type GuestPhase = 'green-room' | 'waiting' | 'live' | 'ended';

export interface GuestParticipant {
  sessionId: string;
  userName: string;
  local: boolean;
  /** The room owner = the host. Their published video is the program composite
   * (host + all guest tiles), not a raw face camera, so the guest studio hides
   * it from the video stage to avoid showing everyone twice. */
  owner: boolean;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
  /** Screen share / slideshow track when this participant is presenting. */
  screenTrack: MediaStreamTrack | null;
}

/**
 * Headless guest connection to a Daily room. Unlike useDailyBroadcast (which
 * publishes a composited canvas and drives RTMP), a guest publishes their raw
 * webcam/mic and just needs to see/hear the host. Daily's own UI never renders
 * — we use the call object and paint everything in our branded studio.
 */
export function useDailyGuest() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callRef = useRef<any>(null);
  const leavingRef = useRef(false);
  const userNameRef = useRef('Guest');
  const [status, setStatus] = useState<GuestStatus>('idle');
  const [phase, setPhase] = useState<GuestPhase>('green-room');
  const [participants, setParticipants] = useState<GuestParticipant[]>([]);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [forgeChat, setForgeChat] = useState<ForgeChatMessage[]>([]);
  // The shared waiting-room agenda the host writes (empty until/unless sent).
  const [brief, setBrief] = useState('');
  // Newest brief timestamp seen, so a re-broadcast to a late joiner can't clobber
  // a fresher edit that arrived first.
  const briefAtRef = useRef(0);

  const refreshParticipants = useCallback(() => {
    const call = callRef.current;
    if (!call) {
      setParticipants([]);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = Object.values(call.participants() ?? {}) as any[];
    setParticipants(
      all.map(p => {
        const usable = (t?: { state?: string }) =>
          t?.state === 'playable' || t?.state === 'sendable' || t?.state === 'loading';
        const screen = p.tracks?.screenVideo;
        const screenTrack = usable(screen)
          ? (screen.persistentTrack ?? screen.track ?? null)
          : null;
        const compositeTrack = (p.tracks?.video?.persistentTrack ?? p.tracks?.video?.track ?? null) as MediaStreamTrack | null;
        // The host's main video is the program composite; it also publishes its
        // raw camera as the `hostcam` custom track. Prefer that for the host tile
        // so the guest sees the host's face alone, not the whole program grid.
        const hostCam = p.tracks?.hostcam;
        const hostCamTrack = usable(hostCam) ? (hostCam.persistentTrack ?? hostCam.track ?? null) : null;
        return {
          sessionId: p.session_id as string,
          userName: (p.user_name as string) || (p.local ? 'You' : 'Guest'),
          local: !!p.local,
          owner: !!p.owner,
          videoTrack: (p.owner ? (hostCamTrack ?? compositeTrack) : compositeTrack) as MediaStreamTrack | null,
          audioTrack: (p.tracks?.audio?.persistentTrack ?? p.tracks?.audio?.track ?? null) as MediaStreamTrack | null,
          screenTrack: screenTrack as MediaStreamTrack | null,
        };
      }),
    );
    const local = call.participants()?.local;
    if (local) {
      setIsCameraOn(!!local.video);
      setIsMicOn(!!local.audio);
    }
  }, []);

  const join = useCallback(async (
    roomUrl: string,
    token: string,
    opts?: { videoDeviceId?: string; audioDeviceId?: string; userName?: string; initialLive?: boolean },
  ) => {
    if (callRef.current) {
      try { await callRef.current.leave(); } catch { /* noop */ }
      try { callRef.current.destroy(); } catch { /* noop */ }
      callRef.current = null;
    }
    leavingRef.current = false;
    userNameRef.current = opts?.userName || 'Guest';
    setStatus('connecting');

    // daily-js is heavy — load on demand, same as the host broadcast hook.
    const { default: DailyIframe } = await import('@daily-co/daily-js');

    const call = DailyIframe.createCallObject({
      // A guest wants to see and hear the host + co-guests automatically.
      subscribeToTracksAutomatically: true,
    });

    // Honor the devices chosen in the green room (createCallObject doesn't take
    // device ids — they must be set on the call object before joining).
    if (opts?.videoDeviceId || opts?.audioDeviceId) {
      try {
        await call.setInputDevicesAsync({
          ...(opts.videoDeviceId ? { videoDeviceId: opts.videoDeviceId } : {}),
          ...(opts.audioDeviceId ? { audioDeviceId: opts.audioDeviceId } : {}),
        });
      } catch (err) {
        console.warn('[DailyGuest] could not pre-select devices:', err);
      }
    }

    // The host starting/stopping RTMP is our live/waiting signal.
    call.on('live-streaming-started', () => {
      if (callRef.current === call) setPhase('live');
    });
    call.on('live-streaming-stopped', () => {
      if (callRef.current === call) setPhase('waiting');
    });
    call.on('participant-joined', () => { if (callRef.current === call) refreshParticipants(); });
    call.on('participant-updated', () => { if (callRef.current === call) refreshParticipants(); });
    call.on('participant-left', () => { if (callRef.current === call) refreshParticipants(); });
    // Screen share / slides ride the same Daily screen channel.
    call.on('local-screen-share-started', () => { if (callRef.current === call) { setIsScreenSharing(true); refreshParticipants(); } });
    call.on('local-screen-share-stopped', () => { if (callRef.current === call) { setIsScreenSharing(false); refreshParticipants(); } });
    // Forge Chat: private backstage messages from the host / co-guests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('app-message', (ev: any) => {
      if (callRef.current !== call) return;
      if (isForgeChatWire(ev?.data)) {
        setForgeChat(prev => [...prev, {
          id: ev.data.id,
          author: ev.data.author || 'Host',
          text: ev.data.text,
          mine: false,
          timestamp: new Date(),
        }].slice(-FORGE_CHAT_MAX));
      } else if (isBackstageBriefWire(ev?.data)) {
        // Keep only the newest agenda (re-broadcasts to late joiners may arrive
        // out of order).
        if (ev.data.updatedAt >= briefAtRef.current) {
          briefAtRef.current = ev.data.updatedAt;
          setBrief(ev.data.text);
        }
      }
    });
    // Ejected by the host, or the room was deleted (stream ended).
    call.on('left-meeting', () => {
      if (callRef.current === call && !leavingRef.current) setPhase('ended');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('error', (ev: any) => {
      console.error('[DailyGuest] error:', ev?.errorMsg || ev);
      if (callRef.current === call) setStatus('error');
    });

    callRef.current = call;

    await call.join({ url: roomUrl, token, userName: opts?.userName });
    // The meeting token carries its own user_name, which overrides join()'s
    // userName — so re-apply the name the guest chose in the green room. This
    // makes the host see the correct name the moment the guest joins.
    if (opts?.userName) {
      try { call.setUserName(opts.userName); } catch { /* not connected */ }
    }

    setStatus('joined');
    // The backend (guest-access) tells us whether the host is already live so
    // we don't have to wait for a live-streaming event that already fired.
    setPhase(prev => (prev === 'live' || opts?.initialLive ? 'live' : 'waiting'));
    refreshParticipants();
    return call;
  }, [refreshParticipants]);

  // Send a private Forge Chat message to the host / co-guests.
  const sendForgeChat = useCallback((text: string) => {
    const call = callRef.current;
    if (!call) return;
    const id = crypto.randomUUID();
    const author = userNameRef.current;
    const wire: ForgeChatWire = { t: FORGE_CHAT_TYPE, id, author, text };
    try { call.sendAppMessage(wire, '*'); } catch { /* not connected */ }
    setForgeChat(prev => [...prev, {
      id, author, text, mine: true, timestamp: new Date(),
    }].slice(-FORGE_CHAT_MAX));
  }, []);

  // Rename the guest live. Updates the Daily participant name (so the host and
  // co-guests see it in real time) and the Forge Chat author for future
  // messages.
  const setUserName = useCallback((name: string) => {
    const n = name.trim();
    if (!n) return;
    userNameRef.current = n;
    try { callRef.current?.setUserName(n); } catch { /* not joined */ }
  }, []);

  const leave = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    leavingRef.current = true;
    callRef.current = null;
    setParticipants([]);
    setForgeChat([]);
    setBrief('');
    briefAtRef.current = 0;
    try { await call.leave(); } catch { /* noop */ }
    try { call.destroy(); } catch { /* noop */ }
    setStatus('idle');
  }, []);

  const setCamera = useCallback((enabled: boolean) => {
    callRef.current?.setLocalVideo(enabled);
    setIsCameraOn(enabled);
  }, []);

  const setMic = useCallback((enabled: boolean) => {
    callRef.current?.setLocalAudio(enabled);
    setIsMicOn(enabled);
  }, []);

  // Publish the guest's screen. With a mediaStream (e.g. a slideshow canvas)
  // that stream is shared; without one Daily prompts for a display to capture.
  const startScreenShare = useCallback((mediaStream?: MediaStream) => {
    try {
      callRef.current?.startScreenShare(mediaStream ? { mediaStream } : undefined);
    } catch (err) {
      console.error('[DailyGuest] startScreenShare failed:', err);
    }
  }, []);

  const stopScreenShare = useCallback(() => {
    try { callRef.current?.stopScreenShare(); } catch { /* not sharing */ }
  }, []);

  const setInputDevices = useCallback(async (devices: { videoDeviceId?: string; audioDeviceId?: string }) => {
    try {
      await callRef.current?.setInputDevicesAsync({
        ...(devices.videoDeviceId ? { videoDeviceId: devices.videoDeviceId } : {}),
        ...(devices.audioDeviceId ? { audioDeviceId: devices.audioDeviceId } : {}),
      });
    } catch (err) {
      console.error('[DailyGuest] setInputDevices failed:', err);
    }
  }, []);

  useEffect(() => {
    return () => {
      const call = callRef.current;
      if (call) {
        callRef.current = null;
        call.leave().catch(() => {});
        call.destroy();
      }
    };
  }, []);

  return {
    status,
    phase,
    participants,
    isCameraOn,
    isMicOn,
    isScreenSharing,
    forgeChat,
    sendForgeChat,
    brief,
    join,
    leave,
    setCamera,
    setMic,
    setUserName,
    startScreenShare,
    stopScreenShare,
    setInputDevices,
  };
}
