import { useStudio } from '@/contexts/StudioContext';
import { Wifi, WifiOff, Radio, Clock, Activity, ArrowUp, Video, Volume2, Users, Eye } from 'lucide-react';
import { PlatformIcon } from './PlatformIcon';
import { useState, useEffect, useRef } from 'react';
import type { StreamHealthStats } from '@/hooks/useDailyBroadcast';
import type { PlatformViewerCount } from '@/hooks/useViewerAnalytics';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function StreamTimer() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-1.5 bg-secondary/60 rounded-md px-2.5 py-1.5">
      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-sm font-mono font-semibold text-foreground tabular-nums tracking-wider">
        {formatDuration(elapsed)}
      </span>
    </div>
  );
}

const qualityConfig = {
  excellent: { label: 'Excellent', color: 'text-green-500', bg: 'bg-green-500', barCount: 4 },
  good: { label: 'Good', color: 'text-green-400', bg: 'bg-green-400', barCount: 3 },
  fair: { label: 'Fair', color: 'text-yellow-500', bg: 'bg-yellow-500', barCount: 2 },
  poor: { label: 'Poor', color: 'text-destructive', bg: 'bg-destructive', barCount: 1 },
} as const;

function QualityBars({ quality }: { quality: StreamHealthStats['quality'] }) {
  const { barCount, bg } = qualityConfig[quality];
  return (
    <div className="flex items-end gap-[2px] h-3">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className={`w-[3px] rounded-sm transition-colors ${
            i <= barCount ? bg : 'bg-muted-foreground/20'
          }`}
          style={{ height: `${i * 25}%` }}
        />
      ))}
    </div>
  );
}

function StreamHealthIndicator({ stats }: { stats: StreamHealthStats }) {
  const { label, color } = qualityConfig[stats.quality];
  const totalBitrate = stats.videoBitrate + stats.audioBitrate;

  return (
    <div className="border-t border-border pt-3 space-y-2.5">
      {/* Quality header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Stream Health
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <QualityBars quality={stats.quality} />
          <span className={`text-[11px] font-semibold ${color}`}>{label}</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-secondary/40 rounded-md p-2 text-center">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <ArrowUp className="h-2.5 w-2.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground uppercase">Bitrate</span>
          </div>
          <span className="text-xs font-mono font-semibold text-foreground tabular-nums">
            {totalBitrate > 1000 ? `${(totalBitrate / 1000).toFixed(1)} Mbps` : `${totalBitrate} kbps`}
          </span>
        </div>

        <div className="bg-secondary/40 rounded-md p-2 text-center">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <Video className="h-2.5 w-2.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground uppercase">FPS</span>
          </div>
          <span className="text-xs font-mono font-semibold text-foreground tabular-nums">
            {stats.videoFrameRate}
          </span>
        </div>

        <div className="bg-secondary/40 rounded-md p-2 text-center">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <Volume2 className="h-2.5 w-2.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground uppercase">Loss</span>
          </div>
          <span className={`text-xs font-mono font-semibold tabular-nums ${
            stats.packetLoss > 5 ? 'text-destructive' : stats.packetLoss > 2 ? 'text-yellow-500' : 'text-foreground'
          }`}>
            {stats.packetLoss}%
          </span>
        </div>
      </div>

      {/* Bitrate breakdown */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>Video: {stats.videoBitrate} kbps</span>
        <span>Audio: {stats.audioBitrate} kbps</span>
      </div>
    </div>
  );
}

function PlatformViewers({ platforms }: { platforms: PlatformViewerCount[] }) {
  if (!platforms.length) return null;

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Platform Viewers
        </span>
      </div>
      <div className="grid gap-1.5">
        {platforms.map((p, i) => (
          <div
            key={`${p.platform}-${i}`}
            className="flex items-center justify-between bg-secondary/40 rounded-md px-2.5 py-1.5"
          >
            <div className="flex items-center gap-1.5">
              <PlatformIcon platform={p.platform} className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] font-medium text-foreground truncate max-w-[120px]">
                {p.name}
              </span>
            </div>
            {p.error ? (
              <span className="text-[11px] text-muted-foreground/60">unavailable</span>
            ) : (
              <span className="text-xs font-mono font-semibold text-foreground tabular-nums">
                {p.viewers ?? '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StreamStatusPanel() {
  const { isLive, broadcastStatus, healthStats, viewerCount, platformViewers } = useStudio();

  if (!isLive) return null;

  const isBrowserBroadcasting = broadcastStatus === 'broadcasting';
  const isConnecting = broadcastStatus === 'connecting' || broadcastStatus === 'joined';

  const totalPlatformViewers = platformViewers?.reduce((sum, p) => sum + (p.viewers ?? 0), 0) ?? 0;
  const displayViewerCount = totalPlatformViewers > 0 ? totalPlatformViewers : viewerCount;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-live animate-pulse-live" />
          <h3 className="text-sm font-semibold text-foreground">Live Stream Active</h3>
        </div>
        <div className="flex items-center gap-2">
          {displayViewerCount > 0 && (
            <div className="flex items-center gap-1 bg-secondary/60 rounded-md px-2 py-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-mono font-semibold text-foreground tabular-nums">
                {displayViewerCount}
              </span>
            </div>
          )}
          <StreamTimer />
        </div>
      </div>

      {/* Browser broadcast status */}
      {(isBrowserBroadcasting || isConnecting) && (
        <div className={`flex items-start gap-2 rounded-md p-2.5 border ${
          isBrowserBroadcasting
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-yellow-500/10 border-yellow-500/30'
        }`}>
          {isBrowserBroadcasting ? (
            <Radio className="h-4 w-4 text-green-500 shrink-0 mt-0.5 animate-pulse" />
          ) : (
            <Wifi className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5 animate-pulse" />
          )}
          <div>
            <p className={`text-xs font-medium ${isBrowserBroadcasting ? 'text-green-500' : 'text-yellow-500'}`}>
              {isBrowserBroadcasting ? 'Broadcasting from Browser' : 'Connecting...'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {isBrowserBroadcasting
                ? 'Your camera and audio are streaming live to your destination.'
                : 'Setting up the broadcast connection...'}
            </p>
          </div>
        </div>
      )}

      {/* Broadcast error */}
      {broadcastStatus === 'error' && (
        <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-md p-2.5">
          <WifiOff className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-destructive">Broadcast Error</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Failed to connect to the streaming service. Please try again.
            </p>
          </div>
        </div>
      )}

      {/* Per-platform viewer counts */}
      {platformViewers && platformViewers.length > 0 && (
        <PlatformViewers platforms={platformViewers} />
      )}

      {/* Stream health indicator */}
      {isBrowserBroadcasting && healthStats && (
        <StreamHealthIndicator stats={healthStats} />
      )}

      {isBrowserBroadcasting && !healthStats && (
        <div className="border-t border-border pt-2">
          <p className="text-[11px] text-muted-foreground">
            Your stream is being sent directly from your browser. No external encoder needed.
          </p>
        </div>
      )}
    </div>
  );
}
