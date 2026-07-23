import { useStudio, type RecordingMode } from '@/contexts/StudioContext';
import { Switch } from '@/components/ui/switch';
import { HardDrive, Cloud, Combine, Circle, Square, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';

const STORAGE_MODES: Array<{ id: RecordingMode; label: string; icon: React.ElementType; blurb: string }> = [
  { id: 'local', label: 'Local', icon: HardDrive, blurb: 'Downloads directly to your device' },
  { id: 'cloud', label: 'Cloud', icon: Cloud, blurb: 'Saved to your cloud library for later streaming' },
  { id: 'both', label: 'Both', icon: Combine, blurb: 'Downloads to your device and uploads to the cloud library' },
];

export function RecordingSettings() {
  const {
    recordingMode, setRecordingMode,
    isRecording, startGradedRecording, stopRecordingWithMode,
    cameraStream, screenStream,
    autoRecordOnLive, setAutoRecordOnLive,
  } = useStudio();

  const [title, setTitle] = useState('');
  const hasStream = !!(screenStream || cameraStream);
  const activeMode = STORAGE_MODES.find(m => m.id === recordingMode) ?? STORAGE_MODES[0];

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecordingWithMode();
    } else if (hasStream) {
      void startGradedRecording(title || undefined);
      setTitle('');
    }
  };

  return (
    <div className="space-y-5">
      {/* Storage mode */}
      <div className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Storage Mode</h3>
        <div className="grid grid-cols-3 gap-1.5">
          {STORAGE_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setRecordingMode(m.id)}
              disabled={isRecording}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-50 ${
                recordingMode === m.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              <m.icon className="h-4 w-4" />
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{activeMode.blurb}</p>
      </div>

      {/* Auto-record on live toggle */}
      <div className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Auto-Record</h3>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40">
          <Radio className={`h-4 w-4 shrink-0 ${autoRecordOnLive ? 'text-primary' : 'text-muted-foreground'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Record when live</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically start recording when you go live
            </p>
          </div>
          <Switch
            checked={autoRecordOnLive}
            onCheckedChange={setAutoRecordOnLive}
            disabled={isRecording}
          />
        </div>
        {autoRecordOnLive && (
          <p className="text-[11px] text-muted-foreground pl-1">
            Recording will save as <strong className="text-foreground">{activeMode.label.toLowerCase()}</strong> using the mode above
          </p>
        )}
      </div>

      {/* Recording title */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Recording Title
        </label>
        <Input
          placeholder="My recording..."
          value={title}
          onChange={e => setTitle(e.target.value)}
          disabled={isRecording}
          className="text-sm"
        />
      </div>

      {/* Record button */}
      <Button
        onClick={handleToggleRecording}
        disabled={!hasStream}
        variant={isRecording ? 'destructive' : 'default'}
        className="w-full gap-2"
      >
        {isRecording ? (
          <>
            <Square className="h-4 w-4 fill-current" />
            Stop Recording
          </>
        ) : (
          <>
            <Circle className="h-4 w-4" />
            Start Recording
          </>
        )}
      </Button>

      {!hasStream && (
        <p className="text-xs text-muted-foreground text-center">
          Enable camera or screen share to record
        </p>
      )}

      {/* Info */}
      <div className="border-t border-border pt-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Info</h3>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li className="flex items-start gap-2">
            <HardDrive className="h-3 w-3 mt-0.5 shrink-0" />
            <span><strong className="text-foreground">Local</strong> — saves as .webm file to your device</span>
          </li>
          <li className="flex items-start gap-2">
            <Cloud className="h-3 w-3 mt-0.5 shrink-0" />
            <span><strong className="text-foreground">Cloud</strong> — uploads to your library for re-streaming</span>
          </li>
          <li className="flex items-start gap-2">
            <Combine className="h-3 w-3 mt-0.5 shrink-0" />
            <span><strong className="text-foreground">Both</strong> — device download plus cloud upload in one take</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
