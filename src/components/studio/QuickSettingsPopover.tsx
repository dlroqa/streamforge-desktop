import { ChevronUp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useState } from 'react';

interface QuickSettingsPopoverProps {
  /** aria-label for the corner arrow trigger. */
  ariaLabel: string;
  /** Popover width class, e.g. "w-72". */
  widthClass?: string;
  /** Panel body. Receives `open` so live work (meters, previews) can idle while
   * the panel is closed. */
  children: (open: boolean) => React.ReactNode;
}

/**
 * The expand-up settings arrow tucked into a control button's upper-right
 * corner — the same affordance as the "Go Live" record button — opening a
 * compact settings panel above it.
 *
 * Rendered as an absolutely-positioned sibling of the button it decorates, so
 * clicking the arrow never triggers the button's own action. Wrap the button
 * and this component together in a `relative` container.
 */
export function QuickSettingsPopover({ ariaLabel, widthClass = 'w-72', children }: QuickSettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={e => e.stopPropagation()}
          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors z-10"
          aria-label={ariaLabel}
        >
          <ChevronUp className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={12} className={`${widthClass} p-4`}>
        {children(open)}
      </PopoverContent>
    </Popover>
  );
}
