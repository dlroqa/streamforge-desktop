import { useStudio } from '@/contexts/StudioContext';
import { useEffect, useRef } from 'react';

function GuestAudioSink({ track, volume }: { track: MediaStreamTrack; volume: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = new MediaStream([track]);
    el.play().catch(() => { /* autoplay is allowed after the go-live gesture */ });
    return () => {
      el.srcObject = null;
    };
  }, [track]);

  // The Scenes switcher's per-guest volume control drives the local monitor
  // level (broadcast guest audio is muxed server-side, so it's unaffected).
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  return <audio ref={audioRef} autoPlay />;
}

/**
 * Plays guest audio locally so the host hears them. Guest audio reaches
 * viewers via Daily's server-side mux, not through these elements.
 */
export function GuestAudio() {
  const { guests, guestVolumes } = useStudio();

  return (
    <div className="hidden">
      {guests
        .filter(g => g.audioTrack)
        .map(g => (
          <GuestAudioSink
            key={g.sessionId}
            track={g.audioTrack!}
            volume={guestVolumes[g.sessionId] ?? 100}
          />
        ))}
    </div>
  );
}
