import { useEffect, useState } from 'react';

/**
 * Real-time input level (0–100) for a MediaStream's audio, measured via an
 * AnalyserNode (RMS of the time-domain signal). Returns 0 when the stream has
 * no audio track or its track is disabled (muted).
 */
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLevel(0);
      return;
    }

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let peak = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      // Scale for typical speech levels; peak-hold with decay for a
      // natural-feeling meter.
      const instant = Math.min(100, rms * 300);
      peak = Math.max(instant, peak * 0.8);
      setLevel(Math.round(peak));
    };

    const interval = setInterval(tick, 80);

    return () => {
      clearInterval(interval);
      source.disconnect();
      audioCtx.close().catch(() => { /* already closed */ });
      setLevel(0);
    };
  }, [stream]);

  return level;
}
