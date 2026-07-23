import { useState, useRef, useCallback, useEffect } from 'react';
import {
  FORGE_CHAT_TYPE, FORGE_CHAT_MAX, isForgeChatWire,
  type ForgeChatMessage, type ForgeChatWire,
} from '@/lib/forgeChat';
import {
  BACKSTAGE_BRIEF_TYPE, BACKSTAGE_BRIEF_MAX,
  type BackstageBriefWire,
} from '@/lib/backstageBrief';

export type BroadcastStatus = 'idle' | 'connecting' | 'joined' | 'broadcasting' | 'error';

/** Daily custom-track name the host publishes its RAW camera on (separate from
 * the composite it sends as its main video). Guests subscribe to this so their
 * host tile shows the host's camera alone, not the whole program grid. */
const HOST_CAM_TRACK = 'hostcam';

export interface DailyGuest {
  sessionId: string;
  userName: string;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
}

export interface StreamHealthStats {
  videoBitrate: number;    // kbps
  audioBitrate: number;    // kbps
  videoFrameRate: number;  // fps
  packetLoss: number;      // percentage 0-100
  quality: 'excellent' | 'good' | 'fair' | 'poor';
}

function computeQuality(bitrate: number, packetLoss: number): StreamHealthStats['quality'] {
  if (packetLoss > 10 || bitrate < 200) return 'poor';
  if (packetLoss > 5 || bitrate < 500) return 'fair';
  if (packetLoss > 2 || bitrate < 1500) return 'good';
  return 'excellent';
}

export function useDailyBroadcast() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callRef = useRef<any>(null);
  const [status, setStatus] = useState<BroadcastStatus>('idle');
  const [healthStats, setHealthStats] = useState<StreamHealthStats | null>(null);
  const [guests, setGuests] = useState<DailyGuest[]>([]);
  const [forgeChat, setForgeChat] = useState<ForgeChatMessage[]>([]);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Which raw-camera track (if any) we've published as the HOST_CAM_TRACK
  // custom track, so we only republish when it actually changes.
  const hostCamTrackRef = useRef<MediaStreamTrack | null>(null);
  // The last backstage brief we sent, re-broadcast whenever a guest joins so
  // late arrivals see the current agenda (null = never set anything to send).
  const lastBriefRef = useRef<BackstageBriefWire | null>(null);

  // Rebuild the guest list from Daily's participant map (everyone but us)
  const refreshGuests = useCallback(() => {
    const call = callRef.current;
    if (!call) {
      setGuests([]);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const participants = Object.values(call.participants() ?? {}) as any[];
    setGuests(
      participants
        .filter(p => !p.local)
        .map(p => {
          // A guest sharing their screen (or presenting slides) publishes a
          // screenVideo track — show that in their tile instead of their camera.
          const screen = p.tracks?.screenVideo;
          const screenTrack = screen?.state === 'playable'
            ? (screen.persistentTrack ?? screen.track ?? null)
            : null;
          const camTrack = (p.tracks?.video?.persistentTrack ?? p.tracks?.video?.track ?? null) as MediaStreamTrack | null;
          return {
            sessionId: p.session_id as string,
            userName: (p.user_name as string) || 'Guest',
            videoTrack: (screenTrack ?? camTrack) as MediaStreamTrack | null,
            audioTrack: (p.tracks?.audio?.persistentTrack ?? p.tracks?.audio?.track ?? null) as MediaStreamTrack | null,
          };
        }),
    );
  }, []);

  const pollStats = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    try {
      const stats = await call.getNetworkStats();
      const latest = stats?.stats?.latest;
      if (latest) {
        const videoBitrate = Math.round((latest.videoSendBitsPerSecond || 0) / 1000);
        const audioBitrate = Math.round((latest.audioSendBitsPerSecond || 0) / 1000);
        const packetLoss = latest.videoSendPacketLoss ?? latest.audioSendPacketLoss ?? 0;
        const videoFrameRate = latest.videoSendFrameRate || 0;
        setHealthStats({
          videoBitrate,
          audioBitrate,
          videoFrameRate: Math.round(videoFrameRate),
          packetLoss: Math.round(packetLoss * 100) / 100,
          quality: computeQuality(videoBitrate, packetLoss),
        });
      }
    } catch {
      // Stats not available yet — ignore
    }
  }, []);

  const startStatsPolling = useCallback(() => {
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    statsIntervalRef.current = setInterval(pollStats, 3000);
    // Initial poll
    pollStats();
  }, [pollStats]);

  const stopStatsPolling = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    setHealthStats(null);
  }, []);

  const join = useCallback(async (
    roomUrl: string,
    token: string,
    opts?: {
      startVideoOff?: boolean;
      startAudioOff?: boolean;
      /** Custom tracks (e.g. from the stream compositor). When provided,
       * Daily publishes these instead of opening its own camera/mic. */
      videoSource?: MediaStreamTrack;
      audioSource?: MediaStreamTrack;
    },
  ) => {
    // Clean up any existing call
    if (callRef.current) {
      try { await callRef.current.leave(); } catch { /* noop */ }
      try { callRef.current.destroy(); } catch { /* noop */ }
      callRef.current = null;
    }

    setStatus('connecting');

    // daily-js is heavy (~350KB min) and only needed once the user goes
    // live — load it on demand instead of shipping it with the app shell.
    const { default: DailyIframe } = await import('@daily-co/daily-js');

    const call = DailyIframe.createCallObject({
      subscribeToTracksAutomatically: false,
      ...(opts?.videoSource ? { videoSource: opts.videoSource } : {}),
      ...(opts?.audioSource ? { audioSource: opts.audioSource } : {}),
    });

    // Listen for RTMP lifecycle events
    call.on('live-streaming-started', () => {
      console.log('[Daily] live-streaming-started event');
      setStatus('broadcasting');
      startStatsPolling();
    });
    call.on('live-streaming-stopped', () => {
      console.log('[Daily] live-streaming-stopped event');
      stopStatsPolling();
      if (callRef.current === call) {
        setStatus('joined');
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('live-streaming-error', (ev: any) => {
      console.error('[Daily] live-streaming-error event:', JSON.stringify(ev));
      stopStatsPolling();
      if (callRef.current === call) {
        setStatus('error');
      }
    });

    // Guest lifecycle: subscribe to their tracks (we joined with
    // subscribeToTracksAutomatically: false) and keep the guest list fresh.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('participant-joined', (ev: any) => {
      if (callRef.current !== call) return;
      try {
        // Subscribe to all of the guest's tracks (camera, mic, AND screen) so
        // their screen share / slides reach the broadcast when they present.
        call.updateParticipant(ev.participant.session_id, {
          setSubscribedTracks: true,
        });
      } catch { /* participant may have already left */ }
      // Catch a late-joining guest up on the current waiting-room agenda.
      if (lastBriefRef.current) {
        try { call.sendAppMessage(lastBriefRef.current, '*'); } catch { /* not connected */ }
      }
      refreshGuests();
    });
    call.on('participant-updated', () => {
      if (callRef.current === call) refreshGuests();
    });
    call.on('participant-left', () => {
      if (callRef.current === call) refreshGuests();
    });

    // Forge Chat: private backstage messages from guests over the data channel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('app-message', (ev: any) => {
      if (callRef.current !== call) return;
      if (isForgeChatWire(ev?.data)) {
        setForgeChat(prev => [...prev, {
          id: ev.data.id,
          author: ev.data.author || 'Guest',
          text: ev.data.text,
          mine: false,
          timestamp: new Date(),
        }].slice(-FORGE_CHAT_MAX));
      }
    });

    callRef.current = call;

    await call.join({
      url: roomUrl,
      token,
      // With custom sources the published track must stay on — its content
      // (camera on/off, mute) is controlled upstream by the compositor.
      startVideoOff: opts?.videoSource ? false : (opts?.startVideoOff ?? false),
      startAudioOff: opts?.audioSource ? false : (opts?.startAudioOff ?? false),
    });

    // Allow full-resolution sending of the composite track (defaults are
    // tuned for webcams and would downscale a 1080p canvas).
    try {
      await call.updateSendSettings({ video: 'quality-optimized' });
    } catch { /* older room configs may reject this — non-fatal */ }

    setStatus('joined');
    return call;
  }, [startStatsPolling, stopStatsPolling, refreshGuests]);

  // Wait until local tracks settle ('playable', 'off', or 'blocked') so RTMP
  // doesn't start against uninitialized tracks. Bounded — resolves after
  // timeoutMs even if tracks never settle.
  const waitForLocalTracks = useCallback(async (timeoutMs = 5000) => {
    const start = Date.now();
    const settled = (state?: string) =>
      state === 'playable' || state === 'off' || state === 'blocked';
    while (Date.now() - start < timeoutMs) {
      const local = callRef.current?.participants?.()?.local;
      if (local && settled(local.tracks?.video?.state) && settled(local.tracks?.audio?.state)) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }, []);

  const startRtmp = useCallback(async (
    rtmpUrls: string | string[],
    opts?: { width?: number; height?: number },
  ) => {
    const call = callRef.current;
    if (!call) throw new Error('Not joined a Daily room');

    const urls = Array.isArray(rtmpUrls) ? rtmpUrls : [rtmpUrls];
    console.log(`[Daily] Starting live stream to ${urls.length} endpoint(s)`);

    // Use simple rtmpUrl for single destination, array for multiple
    const rtmpUrl = urls.length === 1 ? urls[0] : urls;
    // RTMP output dimensions (defaults to Daily's 1280x720 if omitted)
    const size = opts?.width && opts?.height ? { width: opts.width, height: opts.height } : {};

    // The RTMP output MUST be pinned to our own composite canvas track — that
    // canvas already contains the host scene AND every guest tile. Pinning
    // requires our local session_id. If we started RTMP without it, Daily would
    // fall back to its DEFAULT grid and re-composite every raw participant
    // server-side, mashing the canvas together with the guests' raw cameras
    // (and duplicating each guest). That is the "merged video sources" bug.
    // So: never call startLiveStreaming without a resolved local session_id —
    // poll briefly for it (it is normally present the moment join() resolves).
    let localSessionId: string | undefined = call.participants()?.local?.session_id;
    for (let i = 0; i < 15 && !localSessionId; i++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      localSessionId = call.participants()?.local?.session_id;
    }
    if (!localSessionId) {
      // Without a session_id we cannot pin the layout; refuse rather than
      // emit the merged default grid.
      throw new Error('Cannot start RTMP: local participant not ready');
    }

    // Two ways to pin to the host, both showing ONLY our canvas video:
    // 1. VCS custom `mode: single` — video = host canvas, audio = ALL
    //    participants muxed server-side (guests stay audible, echo-free).
    //    Preferred, but requires VCS support on the Daily domain/plan.
    // 2. `single-participant` preset — guaranteed correct video, but only the
    //    host's own audio reaches RTMP (guest audio is dropped). Safe fallback.
    const vcsLayout = {
      preset: 'custom',
      composition_params: {
        mode: 'single',
        'videoSettings.preferredParticipantIds': localSessionId,
        'videoSettings.showParticipantLabels': false,
      },
    };
    const singleParticipantLayout = {
      preset: 'single-participant',
      session_id: localSessionId,
    };

    try {
      await call.startLiveStreaming({ rtmpUrl, ...size, layout: vcsLayout });
      console.log('[Daily] startLiveStreaming succeeded (VCS single layout, guest audio muxed)');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (vcsErr: any) {
      console.warn('[Daily] VCS layout unavailable, falling back to single-participant (guest audio will not reach RTMP):', vcsErr?.message || vcsErr);
      try {
        await call.startLiveStreaming({ rtmpUrl, ...size, layout: singleParticipantLayout });
        console.log('[Daily] startLiveStreaming succeeded (single-participant fallback)');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error('[Daily] startLiveStreaming failed:', err?.message || err);
        throw err;
      }
    }
  }, []);

  const ejectGuest = useCallback((sessionId: string) => {
    try {
      callRef.current?.updateParticipant(sessionId, { eject: true });
    } catch { /* already gone */ }
  }, []);

  // Publish (or update / clear) the host's RAW camera as a Daily custom track so
  // guests can show the host's face alone instead of the program composite. Safe
  // to call repeatedly — republishes only when the track actually changes, and
  // clears the track when the camera is off (guests then show the host avatar).
  const setProgramCamera = useCallback(async (track: MediaStreamTrack | null) => {
    const call = callRef.current;
    if (!call) return;
    if (hostCamTrackRef.current === track) return; // no change
    try {
      if (hostCamTrackRef.current) {
        await call.stopCustomTrack(HOST_CAM_TRACK).catch(() => { /* not published */ });
        hostCamTrackRef.current = null;
      }
      if (track) {
        await call.startCustomTrack({ track, trackName: HOST_CAM_TRACK });
        hostCamTrackRef.current = track;
      }
    } catch (err) {
      // Non-fatal: the broadcast (composite) is unaffected; guests fall back to
      // the composite for their host tile.
      console.warn('[Daily] host camera custom track failed:', err);
    }
  }, []);

  // Send a private Forge Chat message to everyone in the studio (guests).
  const sendForgeChat = useCallback((text: string, author = 'Host') => {
    const call = callRef.current;
    if (!call) return;
    const id = crypto.randomUUID();
    const wire: ForgeChatWire = { t: FORGE_CHAT_TYPE, id, author, text };
    try { call.sendAppMessage(wire, '*'); } catch { /* not connected */ }
    setForgeChat(prev => [...prev, {
      id, author, text, mine: true, timestamp: new Date(),
    }].slice(-FORGE_CHAT_MAX));
  }, []);

  // Broadcast the current waiting-room agenda to every guest, and remember it so
  // guests who join later get caught up (see the participant-joined handler).
  const sendBackstageBrief = useCallback((text: string) => {
    const wire: BackstageBriefWire = {
      t: BACKSTAGE_BRIEF_TYPE,
      text: text.slice(0, BACKSTAGE_BRIEF_MAX),
      updatedAt: Date.now(),
    };
    lastBriefRef.current = wire;
    try { callRef.current?.sendAppMessage(wire, '*'); } catch { /* not connected */ }
  }, []);

  const leave = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    callRef.current = null;
    hostCamTrackRef.current = null;
    lastBriefRef.current = null;
    setGuests([]);
    setForgeChat([]);
    stopStatsPolling();
    try { await call.stopLiveStreaming(); } catch { /* noop */ }
    try { await call.leave(); } catch { /* noop */ }
    try { call.destroy(); } catch { /* noop */ }
    setStatus('idle');
  }, [stopStatsPolling]);

  // Update the host's Daily participant name live (propagates to guests via
  // participant-updated), so an Account-settings rename is reflected mid-stream.
  const setUserName = useCallback((name: string) => {
    const n = name.trim();
    if (!n) return;
    try { callRef.current?.setUserName(n); } catch { /* not joined */ }
  }, []);

  const setCamera = useCallback((enabled: boolean) => {
    callRef.current?.setLocalVideo(enabled);
  }, []);

  const setMic = useCallback((enabled: boolean) => {
    callRef.current?.setLocalAudio(enabled);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStatsPolling();
      const call = callRef.current;
      if (call) {
        callRef.current = null;
        call.stopLiveStreaming().catch(() => {});
        call.leave().catch(() => {});
        call.destroy();
      }
    };
  }, [stopStatsPolling]);

  return {
    status,
    healthStats,
    guests,
    ejectGuest,
    forgeChat,
    sendForgeChat,
    sendBackstageBrief,
    join,
    waitForLocalTracks,
    startRtmp,
    leave,
    setCamera,
    setMic,
    setProgramCamera,
    setUserName,
  };
}
