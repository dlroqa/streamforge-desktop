import { useStudio } from '@/contexts/StudioContext';
import { openLocalRecording } from '@/lib/localRecordings';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Cloud, HardDrive, Play, Clock, Film, Loader2, FileVideo } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Button } from '@/components/ui/button';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function VideoLibrary() {
  const { recordings, recordingsLoading, deleteRecording, getCloudUrl } = useStudio();
  const { toast } = useToast();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const cloudRecordings = recordings.filter(r => r.storage_type === 'cloud' && r.status === 'ready');
  const localRecordings = recordings.filter(r => r.storage_type === 'local');
  const uploadingRecordings = recordings.filter(r => r.status === 'uploading');

  const handlePlay = async (recording: typeof recordings[0]) => {
    setLoadingPreview(true);
    setPlayingId(recording.id);
    try {
      if (recording.storage_type === 'cloud' && recording.storage_path) {
        setPreviewUrl(await getCloudUrl(recording.storage_path));
        return;
      }
      // Local recording: session cache or the persisted file handle
      const result = await openLocalRecording(recording.id);
      if (result.ok === false) {
        setPlayingId(null);
        const fileName = recording.storage_path || `${recording.title}.webm`;
        const denied = result.reason === 'denied';
        toast({
          title: denied ? 'Permission declined' : 'File not reachable from the browser',
          description: denied
            ? 'Allow file access when prompted to play it here.'
            : `Look for "${fileName}" in the folder you saved it to (usually Downloads).`,
        });
        return;
      }
      setPreviewUrl(result.url);
    } finally {
      setLoadingPreview(false);
    }
  };

  const closePreview = () => {
    // Release blob URLs created for local playback
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPlayingId(null);
    setPreviewUrl(null);
  };

  // The inline player, rendered directly beneath the recording being previewed
  // so it opens next to the file the user clicked rather than at the top.
  const renderPreview = (url: string) => (
    <div className="rounded-lg overflow-hidden border border-primary/40 bg-background">
      <video
        src={url}
        controls
        autoPlay
        className="w-full aspect-video bg-background"
      />
      <div className="p-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={closePreview} className="text-xs">
          Close Preview
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Uploading */}
      {uploadingRecordings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Uploading
          </h3>
          {uploadingRecordings.map(r => (
            <div key={r.id} className="bg-secondary/40 rounded-lg p-3 animate-pulse">
              <p className="text-sm font-medium text-foreground">{r.title}</p>
              <p className="text-xs text-muted-foreground mt-1">Uploading to cloud...</p>
            </div>
          ))}
        </div>
      )}

      {/* Cloud recordings */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Cloud className="h-3 w-3" /> Cloud Recordings ({cloudRecordings.length})
        </h3>
        {cloudRecordings.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">No cloud recordings yet</p>
        ) : (
          cloudRecordings.map(r => (
            <Fragment key={r.id}>
              <div className="bg-secondary/40 rounded-lg p-3 group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDuration(r.duration_seconds)}
                      </span>
                      <span>{formatFileSize(r.file_size_bytes)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 font-mono">{formatDate(r.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handlePlay(r)}
                      disabled={loadingPreview}
                      className="p-1.5 rounded text-muted-foreground hover:text-primary transition-colors"
                      title="Preview"
                    >
                      {loadingPreview && playingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteRecording(r.id)}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              {playingId === r.id && previewUrl && renderPreview(previewUrl)}
            </Fragment>
          ))
        )}
      </div>

      {/* Local recordings */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <HardDrive className="h-3 w-3" /> Local Recordings ({localRecordings.length})
        </h3>
        {localRecordings.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">No local recordings yet</p>
        ) : (
          localRecordings.map(r => (
            <Fragment key={r.id}>
              <div className="bg-secondary/40 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDuration(r.duration_seconds)}
                      </span>
                      <span>{formatFileSize(r.file_size_bytes)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 font-mono">{formatDate(r.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handlePlay(r)}
                      disabled={loadingPreview}
                      className="p-1.5 rounded text-muted-foreground hover:text-primary transition-colors"
                      title="Play from device"
                    >
                      {loadingPreview && playingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteRecording(r.id)}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove from library (file stays on your device)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground/60 mt-1.5 flex items-center gap-1 truncate">
                  <FileVideo className="h-3 w-3 shrink-0" />
                  {r.storage_path || 'Saved on device'}
                </p>
              </div>
              {playingId === r.id && previewUrl && renderPreview(previewUrl)}
            </Fragment>
          ))
        )}
      </div>

      {recordings.length === 0 && !recordingsLoading && (
        <div className="text-center py-6">
          <Film className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No recordings yet</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">
            Use the Recording panel to start recording
          </p>
        </div>
      )}
    </div>
  );
}
