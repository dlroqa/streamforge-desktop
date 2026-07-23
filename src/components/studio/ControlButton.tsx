import { Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface ControlButtonProps {
  onClick: () => void;
  /** true = primary/active, false = destructive/off, undefined = neutral */
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  children: React.ReactNode;
}

/** The circular studio control button, shared by the host ControlBar and the
 * guest studio so both toolbars look and feel identical. */
export function ControlButton({ onClick, active, danger, disabled, busy, label, children }: ControlButtonProps) {
  let className = 'w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ';
  if (danger) {
    className += active
      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md'
      : 'bg-secondary text-foreground hover:bg-secondary/80';
  } else if (active === false) {
    className += 'bg-destructive/15 text-destructive hover:bg-destructive/25';
  } else if (active === true) {
    className += 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md';
  } else {
    className += 'bg-secondary text-foreground hover:bg-secondary/80';
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} className={className} disabled={disabled || busy}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : children}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
