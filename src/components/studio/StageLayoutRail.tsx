import { Columns2, PictureInPicture2, Square } from 'lucide-react';

export type StageLayoutValue = 'split' | 'pip' | 'solo';

/**
 * Floating Split / PiP / Solo switcher anchored to the right edge of a video
 * stage. A vertical control rail over video: an elevated, blurred surface so it
 * stays legible on any frame. Shared by the host studio (drives the broadcast
 * scene layout) and the invited-guest studio (drives the guest's local view) so
 * both look identical.
 */
export function StageLayoutRail({ value, onChange, className }: {
  value: StageLayoutValue;
  onChange: (v: StageLayoutValue) => void;
  /** Positioning override; defaults to right-edge, vertically centered. */
  className?: string;
}) {
  const options: { v: StageLayoutValue; Icon: typeof Columns2; label: string; title: string }[] = [
    { v: 'split', Icon: Columns2, label: 'Split', title: 'Equal split — every source side by side' },
    { v: 'pip', Icon: PictureInPicture2, label: 'PiP', title: 'Main source large, the rest as picture-in-picture' },
    { v: 'solo', Icon: Square, label: 'Solo', title: 'Just the main source (others stay audible)' },
  ];
  return (
    <div
      className={
        className ??
        'absolute right-3 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1 rounded-xl border border-border bg-card/90 p-1 shadow-lg backdrop-blur'
      }
    >
      {options.map(({ v, Icon, label, title }) => {
        const active = value === v;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            title={title}
            aria-label={`${label} layout`}
            aria-pressed={active}
            className={`flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors ${
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
