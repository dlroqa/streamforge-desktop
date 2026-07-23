import { useRef, useCallback } from 'react';
import type { StreamHealthStats } from '@/hooks/useDailyBroadcast';
import { useToast } from '@/hooks/use-toast';

const ALERT_COOLDOWN_MS = 30_000; // Don't repeat same alert within 30s

export function useHealthAlerts() {
  const { toast } = useToast();
  const lastAlertRef = useRef<Record<string, number>>({});

  const canAlert = useCallback((key: string): boolean => {
    const now = Date.now();
    const last = lastAlertRef.current[key] || 0;
    if (now - last < ALERT_COOLDOWN_MS) return false;
    lastAlertRef.current[key] = now;
    return true;
  }, []);

  const checkHealth = useCallback((stats: StreamHealthStats) => {
    // Poor quality alert
    if (stats.quality === 'poor' && canAlert('poor_quality')) {
      toast({
        title: '⚠️ Poor Stream Quality',
        description: 'Your connection quality has dropped significantly. Consider reducing resolution or checking your network.',
        variant: 'destructive',
      });
    }

    // High packet loss
    if (stats.packetLoss > 8 && canAlert('packet_loss')) {
      toast({
        title: '📡 High Packet Loss',
        description: `Packet loss is at ${stats.packetLoss}%. Your viewers may experience buffering. Check your connection.`,
        variant: 'destructive',
      });
    }

    // Low bitrate warning
    if (stats.videoBitrate > 0 && stats.videoBitrate < 300 && canAlert('low_bitrate')) {
      toast({
        title: '📉 Low Bitrate',
        description: `Video bitrate dropped to ${stats.videoBitrate} kbps. Stream quality may be poor for viewers.`,
        variant: 'destructive',
      });
    }

    // Low frame rate
    if (stats.videoFrameRate > 0 && stats.videoFrameRate < 15 && canAlert('low_fps')) {
      toast({
        title: '🎬 Low Frame Rate',
        description: `Frame rate is ${stats.videoFrameRate} FPS. Your stream may appear choppy.`,
      });
    }

    // Fair quality gentle nudge
    if (stats.quality === 'fair' && canAlert('fair_quality')) {
      toast({
        title: '📶 Stream Quality Degraded',
        description: 'Connection quality is fair. Monitor for further degradation.',
      });
    }
  }, [toast, canAlert]);

  const reset = useCallback(() => {
    lastAlertRef.current = {};
  }, []);

  return { checkHealth, reset };
}
