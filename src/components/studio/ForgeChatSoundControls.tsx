import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Play } from 'lucide-react';
import { playForgeChime } from '@/lib/notificationSound';

/**
 * Alert-sound controls for a Forge Chat header: a speaker button that opens
 * mute + volume for the chime played when a new message arrives. Presentational
 * (state is owned by the caller) so both the host studio and the invited-guest
 * studio can render it — the host feeds it StudioContext state, the guest feeds
 * it its own local state.
 */
export function ForgeChatSoundControls({
  muted, volume, onToggle, onVolumeChange, description,
}: {
  muted: boolean;
  volume: number;
  onToggle: () => void;
  onVolumeChange: (v: number) => void;
  /** Blurb under the title, e.g. who the alert is for. */
  description?: string;
}) {
  const on = !muted;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title={on ? 'Message alert sound' : 'Message alerts muted'}
        >
          {on ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-3 space-y-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Message alerts</p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
            {description || 'Chime when a new Forge Chat message arrives.'}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-foreground">Sound</span>
          <Switch checked={on} onCheckedChange={onToggle} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Volume</span>
            <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
              {on ? `${volume}%` : 'Muted'}
            </span>
          </div>
          <Slider
            value={[volume]}
            onValueChange={([v]) => onVolumeChange(v)}
            max={100}
            step={1}
            disabled={!on}
            className="w-full"
          />
        </div>

        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 gap-1.5 text-[11px]"
          onClick={() => playForgeChime(volume)}
          disabled={!on}
        >
          <Play className="h-3 w-3" />
          Test sound
        </Button>
      </PopoverContent>
    </Popover>
  );
}
