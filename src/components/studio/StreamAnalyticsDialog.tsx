import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Area, AreaChart, XAxis, YAxis } from 'recharts';
import { Users, TrendingUp, Clock, Activity, BarChart3, Zap } from 'lucide-react';
import type { StreamAnalytics } from '@/hooks/useStreamAnalytics';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <p className="text-lg font-semibold font-mono text-foreground tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function QualityBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-16">{label}</span>
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-muted-foreground tabular-nums w-8 text-right">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  analytics: StreamAnalytics | null;
}

export function StreamAnalyticsDialog({ open, onClose, analytics }: Props) {
  if (!analytics) return null;

  const totalSamples = Object.values(analytics.qualitySummary).reduce((a, b) => a + b, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Stream Summary
          </DialogTitle>
          <DialogDescription>
            Here's how your stream performed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Clock}
            label="Duration"
            value={formatDuration(analytics.totalDuration)}
          />
          <StatCard
            icon={Users}
            label="Peak Viewers"
            value={analytics.peakViewers.toString()}
          />
          <StatCard
            icon={TrendingUp}
            label="Avg Bitrate"
            value={
              analytics.averageBitrate > 1000
                ? `${(analytics.averageBitrate / 1000).toFixed(1)} Mbps`
                : `${analytics.averageBitrate} kbps`
            }
            sub={`Peak: ${analytics.peakBitrate > 1000 ? `${(analytics.peakBitrate / 1000).toFixed(1)} Mbps` : `${analytics.peakBitrate} kbps`}`}
          />
          <StatCard
            icon={Activity}
            label="Avg FPS"
            value={analytics.averageFps.toString()}
          />
        </div>

        {totalSamples > 0 && (
          <div className="space-y-2 mt-2">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                Quality Distribution
              </span>
            </div>
            <div className="space-y-1.5">
              <QualityBar label="Excellent" count={analytics.qualitySummary.excellent} total={totalSamples} color="bg-green-500" />
              <QualityBar label="Good" count={analytics.qualitySummary.good} total={totalSamples} color="bg-green-400" />
              <QualityBar label="Fair" count={analytics.qualitySummary.fair} total={totalSamples} color="bg-yellow-500" />
              <QualityBar label="Poor" count={analytics.qualitySummary.poor} total={totalSamples} color="bg-destructive" />
            </div>
          </div>
        )}

        {analytics.viewerTimeline.length > 1 && (
          <div className="space-y-2 mt-2">
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                Viewer Trend
              </span>
            </div>
            <ChartContainer
              config={{
                viewers: { label: 'Viewers', color: 'hsl(var(--primary))' },
              }}
              className="h-[120px] w-full"
            >
              <AreaChart
                data={analytics.viewerTimeline}
                margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
              >
                <defs>
                  <linearGradient id="viewerFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="elapsed"
                  tickFormatter={(v: number) => {
                    const m = Math.floor(v / 60);
                    return m > 0 ? `${m}m` : `${v}s`;
                  }}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        if (!payload?.[0]) return '';
                        const elapsed = payload[0].payload?.elapsed ?? 0;
                        const m = Math.floor(elapsed / 60);
                        const s = elapsed % 60;
                        return m > 0 ? `${m}m ${s}s` : `${s}s`;
                      }}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="viewers"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#viewerFill)"
                />
              </AreaChart>
            </ChartContainer>
          </div>
        )}

        <Button onClick={onClose} className="w-full mt-2">
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
