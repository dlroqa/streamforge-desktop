import { useState, useRef, useCallback } from 'react';
import type { StreamHealthStats } from '@/hooks/useDailyBroadcast';

export interface ViewerTimelinePoint {
  elapsed: number; // seconds since stream start
  viewers: number;
}

export interface StreamAnalytics {
  totalDuration: number; // seconds
  peakViewers: number;
  averageBitrate: number; // kbps
  averageFps: number;
  peakBitrate: number;
  qualitySummary: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  viewerTimeline: ViewerTimelinePoint[];
}

export function useStreamAnalytics() {
  const [analytics, setAnalytics] = useState<StreamAnalytics | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const startTimeRef = useRef<number | null>(null);
  const samplesRef = useRef<{
    bitrates: number[];
    fpsSamples: number[];
    qualityCounts: { excellent: number; good: number; fair: number; poor: number };
    peakBitrate: number;
  }>({
    bitrates: [],
    fpsSamples: [],
    qualityCounts: { excellent: 0, good: 0, fair: 0, poor: 0 },
    peakBitrate: 0,
  });

  const peakViewersRef = useRef(0);
  const viewerTimelineRef = useRef<ViewerTimelinePoint[]>([]);

  const startTracking = useCallback(() => {
    startTimeRef.current = Date.now();
    samplesRef.current = {
      bitrates: [],
      fpsSamples: [],
      qualityCounts: { excellent: 0, good: 0, fair: 0, poor: 0 },
      peakBitrate: 0,
    };
    peakViewersRef.current = 0;
    viewerTimelineRef.current = [];
    setAnalytics(null);
    setShowSummary(false);
  }, []);

  /** Call periodically with the current real viewer count to record timeline + peak */
  const recordViewerCount = useCallback((viewers: number) => {
    peakViewersRef.current = Math.max(peakViewersRef.current, viewers);
    const elapsed = startTimeRef.current
      ? Math.floor((Date.now() - startTimeRef.current) / 1000)
      : 0;
    viewerTimelineRef.current.push({ elapsed, viewers });
  }, []);

  const recordSample = useCallback((stats: StreamHealthStats) => {
    const s = samplesRef.current;
    const totalBitrate = stats.videoBitrate + stats.audioBitrate;
    s.bitrates.push(totalBitrate);
    s.fpsSamples.push(stats.videoFrameRate);
    s.qualityCounts[stats.quality]++;
    s.peakBitrate = Math.max(s.peakBitrate, totalBitrate);
  }, []);

  

  const finishTracking = useCallback(() => {
    const s = samplesRef.current;
    const duration = startTimeRef.current
      ? Math.floor((Date.now() - startTimeRef.current) / 1000)
      : 0;

    const avgBitrate = s.bitrates.length > 0
      ? Math.round(s.bitrates.reduce((a, b) => a + b, 0) / s.bitrates.length)
      : 0;

    const avgFps = s.fpsSamples.length > 0
      ? Math.round(s.fpsSamples.reduce((a, b) => a + b, 0) / s.fpsSamples.length)
      : 0;

    const result: StreamAnalytics = {
      totalDuration: duration,
      peakViewers: peakViewersRef.current,
      averageBitrate: avgBitrate,
      averageFps: avgFps,
      peakBitrate: s.peakBitrate,
      qualitySummary: { ...s.qualityCounts },
      viewerTimeline: [...viewerTimelineRef.current],
    };

    setAnalytics(result);
    setShowSummary(true);
    startTimeRef.current = null;

    return result;
  }, []);

  const dismissSummary = useCallback(() => setShowSummary(false), []);

  return {
    analytics,
    showSummary,
    startTracking,
    recordSample,
    recordViewerCount,
    finishTracking,
    dismissSummary,
  };
}
