import { useStudio } from '@/contexts/StudioContext';
import { useScheduledStreams, type ScheduledStream } from '@/hooks/useScheduledStreams';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Calendar as CalendarIcon, Trash2, Clock, Film, HardDrive, Cloud, Disc, Loader2, Radio, Upload } from 'lucide-react';
import { useState, useRef } from 'react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function StreamScheduler() {
  const { destinations, recordings, uploadVideoFile } = useStudio();
  const { scheduledStreams, loading, addScheduledStream, removeScheduledStream } = useScheduledStreams();

  const [title, setTitle] = useState('');
  const [date, setDate] = useState<Date | undefined>();
  const [hour, setHour] = useState('12');
  const [minute, setMinute] = useState('00');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string>('');
  const [recordStream, setRecordStream] = useState(false);
  const [recordSaveMode, setRecordSaveMode] = useState<'local' | 'cloud'>('cloud');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cloudRecordings = recordings.filter(r => r.storage_type === 'cloud' && r.status === 'ready');
  const localRecordings = recordings.filter(r => r.storage_type === 'local' && r.status === 'ready');
  const selectedRecording = recordings.find(r => r.id === selectedRecordingId);

  const handleAdd = async () => {
    if (!title.trim() || !date) return;

    const scheduledAt = new Date(date);
    scheduledAt.setHours(parseInt(hour), parseInt(minute), 0, 0);

    if (scheduledAt <= new Date()) {
      return; // Can't schedule in the past
    }

    setSubmitting(true);
    await addScheduledStream({
      title,
      scheduled_at: scheduledAt.toISOString(),
      platforms: selectedPlatforms.length > 0 ? selectedPlatforms : ['All Platforms'],
      recording_id: selectedRecordingId || undefined,
      recording_title: selectedRecording?.title,
      record_on_stream: recordStream,
      record_save_mode: recordStream ? recordSaveMode : undefined,
    });
    setTitle('');
    setDate(undefined);
    setHour('12');
    setMinute('00');
    setSelectedPlatforms([]);
    setSelectedRecordingId('');
    setRecordStream(false);
    setRecordSaveMode('cloud');
    setSubmitting(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const success = await uploadVideoFile(file);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // After upload, the new recording will appear in the source dropdown
  };

  const togglePlatform = (p: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const pendingStreams = scheduledStreams.filter(s => s.status === 'pending');
  const pastStreams = scheduledStreams.filter(s => s.status !== 'pending');

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Input
          placeholder="Stream title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="text-sm"
        />

        {/* Date picker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'w-full justify-start text-left font-normal text-sm',
                !date && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-3.5 w-3.5" />
              {date ? format(date, 'PPP') : 'Pick a date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
              initialFocus
              className={cn('p-3 pointer-events-auto')}
            />
          </PopoverContent>
        </Popover>

        {/* Time picker */}
        <div className="grid grid-cols-2 gap-2">
          <Select value={hour} onValueChange={setHour}>
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Hour" />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map(h => (
                <SelectItem key={h} value={h}>{h}:00</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={minute} onValueChange={setMinute}>
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Min" />
            </SelectTrigger>
            <SelectContent>
              {MINUTES.map(m => (
                <SelectItem key={m} value={m}>:{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Source selection */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Source</p>
          <Select value={selectedRecordingId || 'live'} onValueChange={(v) => setSelectedRecordingId(v === 'live' ? '' : v)}>
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Live broadcast (default)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="live">
                <span className="flex items-center gap-2">
                  <Radio className="h-3 w-3 text-destructive" />
                  Live Broadcast
                </span>
              </SelectItem>

              {cloudRecordings.length > 0 && (
                <>
                  <div className="px-2 py-1.5 mt-1">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Cloud className="h-3 w-3" />
                      Cloud Recordings
                    </p>
                  </div>
                  {cloudRecordings.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-2">
                        <Film className="h-3 w-3 text-primary" />
                        <span className="truncate">{r.title}</span>
                        {r.duration_seconds != null && (
                          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                            {formatDuration(r.duration_seconds)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </>
              )}

              {localRecordings.length > 0 && (
                <>
                  <div className="px-2 py-1.5 mt-1">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <HardDrive className="h-3 w-3" />
                      Local Recordings
                    </p>
                  </div>
                  {localRecordings.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-2">
                        <HardDrive className="h-3 w-3 text-muted-foreground" />
                        <span className="truncate">{r.title}</span>
                        {r.duration_seconds != null && (
                          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                            {formatDuration(r.duration_seconds)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>

          {/* Upload video file */}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full gap-2 text-xs"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? 'Uploading...' : 'Upload Video File'}
          </Button>

          {cloudRecordings.length === 0 && localRecordings.length === 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              No recordings yet — record or upload to use pre-recorded content
            </p>
          )}
          {selectedRecording?.storage_type === 'local' && (
            <p className="text-[11px] text-accent mt-1 leading-relaxed">
              Local file: plays from this device — keep the studio open in this
              browser at the scheduled time, with file access granted.
            </p>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed bg-secondary/30 rounded-md px-2.5 py-2">
          Scheduled streams start automatically <strong className="text-foreground">while the
          studio is open</strong>. With a recording selected, it plays as the broadcast and
          the stream ends when it finishes; without one, the stream goes live with
          your cameras.
        </p>

        {destinations.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Platforms</p>
            <div className="flex flex-wrap gap-1.5">
              {destinations.map(d => (
                <button
                  key={d.id}
                  onClick={() => togglePlatform(d.name)}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors font-medium ${
                    selectedPlatforms.includes(d.name)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Record this stream option */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40">
            <Disc className={`h-4 w-4 shrink-0 ${recordStream ? 'text-primary' : 'text-muted-foreground'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Record this stream</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Auto-record when this stream starts
              </p>
            </div>
            <Switch
              checked={recordStream}
              onCheckedChange={setRecordStream}
            />
          </div>
          {recordStream && (
            <div className="flex items-center gap-2 pl-3">
              <button
                onClick={() => setRecordSaveMode('local')}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors font-medium ${
                  recordSaveMode === 'local'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                <HardDrive className="h-3 w-3" />
                Local
              </button>
              <button
                onClick={() => setRecordSaveMode('cloud')}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors font-medium ${
                  recordSaveMode === 'cloud'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                <Cloud className="h-3 w-3" />
                Cloud
              </button>
            </div>
          )}
        </div>

        <Button
          size="sm"
          onClick={handleAdd}
          disabled={!title.trim() || !date || submitting}
          className="w-full gap-2 text-xs"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarIcon className="h-3.5 w-3.5" />}
          Schedule Stream
        </Button>
      </div>

      {loading && (
        <div className="text-center py-4">
          <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
        </div>
      )}

      {!loading && pendingStreams.length > 0 && (
        <div className="border-t border-border pt-4 space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Upcoming</h3>
          {pendingStreams.map(s => (
            <ScheduledStreamCard key={s.id} stream={s} onRemove={removeScheduledStream} />
          ))}
        </div>
      )}

      {!loading && pastStreams.length > 0 && (
        <div className="border-t border-border pt-4 space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Past</h3>
          {pastStreams.slice(0, 5).map(s => (
            <ScheduledStreamCard key={s.id} stream={s} onRemove={removeScheduledStream} />
          ))}
        </div>
      )}

      {!loading && scheduledStreams.length === 0 && (
        <div className="text-center py-4">
          <p className="text-xs text-muted-foreground">No streams scheduled yet</p>
        </div>
      )}
    </div>
  );
}

function ScheduledStreamCard({ stream, onRemove }: { stream: ScheduledStream; onRemove: (id: string) => void }) {
  const scheduledDate = new Date(stream.scheduled_at);
  const statusColors: Record<string, string> = {
    pending: 'text-primary',
    running: 'text-green-500',
    completed: 'text-muted-foreground',
    failed: 'text-destructive',
    cancelled: 'text-muted-foreground',
  };

  return (
    <div className="bg-secondary/40 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{stream.title}</p>
        <div className="flex items-center gap-1 shrink-0">
          {stream.status !== 'pending' && (
            <span className={`text-[11px] font-medium ${statusColors[stream.status] || 'text-muted-foreground'}`}>
              {stream.status}
            </span>
          )}
          <button
            onClick={() => onRemove(stream.id)}
            className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5">
        <Clock className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground font-mono">
          {format(scheduledDate, 'MMM d, yyyy')} at {format(scheduledDate, 'HH:mm')}
        </span>
      </div>
      {stream.recording_title && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <Film className="h-3 w-3 text-primary" />
          <span className="text-xs text-primary font-medium">{stream.recording_title}</span>
        </div>
      )}
      {stream.record_on_stream && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <Disc className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Auto-record → {stream.record_save_mode === 'cloud' ? 'Cloud' : 'Local'}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-2">
        {stream.platforms.map((p: string) => (
          <span key={p} className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}
