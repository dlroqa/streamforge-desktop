import { useStudio, type RecordingMode } from '@/contexts/StudioContext';
import {
  Circle, Square, Radio, ChevronUp, ChevronRight, Check,
  HardDrive, Cloud, Combine, Loader2,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEffect, useState } from 'react';

/** What the record button does when its face is clicked. Persisted so the
 * host's chosen default survives reloads. */
type ButtonAction = 'live' | 'record' | 'both';
const ACTION_KEY = 'studio-record-btn-action';

function loadAction(): ButtonAction {
  const saved = localStorage.getItem(ACTION_KEY);
  return saved === 'record' || saved === 'both' ? saved : 'live';
}

const ACTIONS: Array<{ id: ButtonAction; label: string; blurb: string }> = [
  { id: 'live', label: 'Go Live', blurb: 'Broadcast to your configured destinations' },
  { id: 'record', label: 'Record', blurb: 'Capture to local or cloud (Archive Tools)' },
  { id: 'both', label: 'Both', blurb: 'Go live and record at the same time' },
];

// The three storage modes mirror the Archive Tools panel — writing here updates
// the same shared `recordingMode`, so the two stay in lockstep.
const STORAGE_MODES: Array<{ id: RecordingMode; label: string; icon: React.ElementType }> = [
  { id: 'local', label: 'Local', icon: HardDrive },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'both', label: 'Both', icon: Combine },
];

/**
 * Studio record button with an expand-up settings arrow (upper-right corner).
 * The arrow opens a menu to pick the button's main action — Go Live, Record, or
 * Both — and the face relabels and rewires itself to match. Picking "Record"
 * reveals a flyout to the right for the local/cloud storage mode, bound to the
 * same setting the Archive Tools panel uses.
 */
export function RecordActionButton() {
  const {
    isLive, isStartingLive, isStoppingLive, isRecording,
    goLive, stopLive, toggleRecording, startGradedRecording, stopRecordingWithMode,
    recordingMode, setRecordingMode, autoRecordOnLive, setAutoRecordOnLive,
    cameraStream, isScreenSharing,
  } = useStudio();

  const [action, setAction] = useState<ButtonAction>(loadAction);
  const [menuOpen, setMenuOpen] = useState(false);

  // "Go Live" vs "Both" is exactly the shared "record when live" setting, so
  // keep the button's face in lockstep with it — flip the toggle in Archive
  // Tools (or on the header Go Live flow) and this reflects it, and vice versa.
  // "Record" is a distinct record-only mode and is left untouched.
  useEffect(() => {
    setAction(prev => (prev === 'record' ? 'record' : autoRecordOnLive ? 'both' : 'live'));
  }, [autoRecordOnLive]);

  const chooseAction = (a: ButtonAction) => {
    setAction(a);
    localStorage.setItem(ACTION_KEY, a);
    // Selecting a live-mode writes the shared toggle both ways; record-only
    // leaves it as-is.
    if (a === 'both') setAutoRecordOnLive(true);
    else if (a === 'live') setAutoRecordOnLive(false);
    if (a !== 'record') setMenuOpen(false);
  };

  const hasSource = !!cameraStream || isScreenSharing;
  const activeStorage = STORAGE_MODES.find(m => m.id === recordingMode) ?? STORAGE_MODES[0];

  // Whether the button is currently "on" for its action, plus the click handler
  // and the label/icon that reflect the chosen action and running state.
  const busy = isStartingLive || isStoppingLive;
  let on = false;
  let label = '';
  let icon: React.ReactNode = <Circle className="h-5 w-5" />;
  let onClick: () => void = () => {};
  let disabled = false;

  if (action === 'live') {
    on = isLive;
    label = isLive ? 'End Stream' : 'Go Live';
    icon = <Radio className="h-5 w-5" />;
    onClick = () => (isLive ? void stopLive() : void goLive());
  } else if (action === 'record') {
    on = isRecording;
    label = isRecording ? `Stop — ${activeStorage.label}` : `Record — ${activeStorage.label}`;
    icon = isRecording ? <Square className="h-4 w-4 fill-current" /> : <Circle className="h-5 w-5" />;
    onClick = toggleRecording;
    disabled = !isRecording && !hasSource;
  } else {
    // Both: go live and record together. Starting relies on autoRecordOnLive
    // when it's already on (so we don't double-start the recorder), otherwise
    // we kick the recording off ourselves once the broadcast is up.
    on = isLive || isRecording;
    label = on ? 'Stop Live + Record' : 'Go Live + Record';
    icon = isRecording ? <Square className="h-4 w-4 fill-current" /> : <Radio className="h-5 w-5" />;
    disabled = !on && !hasSource;
    onClick = () => {
      if (on) {
        if (isRecording) stopRecordingWithMode();
        if (isLive) void stopLive();
        return;
      }
      void (async () => {
        await goLive();
        if (!autoRecordOnLive) void startGradedRecording(`Live Recording ${new Date().toLocaleString()}`);
      })();
    };
  }

  // The face styling: live/both idle wear the "live" colour (they broadcast),
  // record idle is neutral, and any running state turns destructive red.
  const face =
    on
      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md'
      : action === 'record'
        ? 'bg-secondary text-foreground hover:bg-secondary/80'
        : 'bg-live text-live-foreground hover:bg-live/90 shadow-md';

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            disabled={disabled || busy}
            className={`h-12 rounded-xl flex items-center gap-2 pl-3.5 pr-4 font-semibold text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${face}`}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
            <span className="whitespace-nowrap">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{ACTIONS.find(a => a.id === action)?.blurb}</p>
        </TooltipContent>
      </Tooltip>

      {/* Expand-up settings arrow, tucked into the upper-right corner. */}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Record button settings"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={10} className="w-56 p-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
            Button Action
          </p>
          <div className="space-y-0.5">
            {ACTIONS.map(a => {
              const selected = action === a.id;
              const row = (
                <button
                  onClick={() => chooseAction(a.id)}
                  className={`w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                    selected
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="text-xs font-medium block">{a.label}</span>
                    <span className="text-[11px] text-muted-foreground block truncate">{a.blurb}</span>
                  </span>
                  {a.id === 'record' && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  {selected && a.id !== 'record' && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              );

              // The Record row carries a flyout to the right for the storage mode.
              if (a.id === 'record') {
                return (
                  <HoverCard key={a.id} openDelay={80} closeDelay={120}>
                    <HoverCardTrigger asChild>
                      <div className="relative">
                        {row}
                        {selected && (
                          <Check className="h-3.5 w-3.5 text-primary absolute right-7 top-1/2 -translate-y-1/2" />
                        )}
                      </div>
                    </HoverCardTrigger>
                    <HoverCardContent side="right" align="start" sideOffset={8} className="w-44 p-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
                        Save To
                      </p>
                      <div className="space-y-0.5">
                        {STORAGE_MODES.map(m => (
                          <button
                            key={m.id}
                            onClick={() => { chooseAction('record'); setRecordingMode(m.id); }}
                            disabled={isRecording}
                            className={`w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              recordingMode === m.id
                                ? 'bg-primary/10 text-foreground'
                                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                            }`}
                          >
                            <m.icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1 text-xs font-medium">{m.label}</span>
                            {recordingMode === m.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground px-2 pt-1">
                        Syncs with Archive Tools.
                      </p>
                    </HoverCardContent>
                  </HoverCard>
                );
              }

              return <div key={a.id}>{row}</div>;
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
