import { useRef, useState } from 'react';
import { useStudio } from '@/contexts/StudioContext';
import { AddMusicDialog } from '@/components/editor/AddMusicDialog';
import { fetchSunoFile, type SunoTrack } from '@/lib/suno';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  Music, Plus, Play, Pause, Square, Repeat, Headphones, X, Volume2,
} from 'lucide-react';

/** Broadcast music bed: add uploaded files or Suno songs/playlists and play
 * them into the live stream, with their own level, loop, and local monitor. */
export function MusicPanel() {
  const {
    musicTracks, musicPlayingId, musicPlaying, musicVolume, musicLoop, musicMonitor,
    addMusicFile, removeMusicTrack, playMusicTrack, toggleMusicPlayback, stopMusic,
    setMusicVolume, toggleMusicLoop, toggleMusicMonitor,
  } = useStudio();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const f of files) await addMusicFile(f, undefined, 'upload');
    if (files.length) toast({ title: files.length > 1 ? `${files.length} tracks added` : 'Track added' });
  };

  // Suno tracks resolve to public MP3s we fetch, then store as blobs (so they
  // mix like any uploaded file and persist across sessions).
  const onLoadSuno = async (tracks: SunoTrack[]) => {
    for (const track of tracks) {
      const file = await fetchSunoFile(track);
      await addMusicFile(file, track.title, 'suno');
    }
    toast({ title: tracks.length > 1 ? `${tracks.length} songs added` : 'Song added', description: 'Added to your music bed.' });
  };

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <Music className="h-4 w-4 text-primary" /> Music
        </h3>
        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{musicTracks.length}</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Play background music or stingers into your broadcast — upload a file or
        load from Suno. Mixed into the outgoing audio with its own level.
      </p>

      <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={onFiles} className="hidden" />

      {musicTracks.length > 0 && (
        <div className="space-y-1">
          {musicTracks.map(t => {
            const active = musicPlayingId === t.id;
            const playing = active && musicPlaying;
            return (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors ${
                  active ? 'border-primary/40 bg-primary/5' : 'border-border bg-secondary/30'
                }`}
              >
                <button
                  onClick={() => (active ? toggleMusicPlayback() : playMusicTrack(t.id))}
                  className="p-1 rounded text-primary hover:bg-primary/10 transition-colors shrink-0"
                  title={playing ? 'Pause' : 'Play'}
                >
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
                <span className="text-xs text-foreground truncate flex-1" title={t.name}>{t.name}</span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-live shrink-0" />}
                <button
                  onClick={() => removeMusicTrack(t.id)}
                  className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title={`Remove ${t.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)} className="w-full gap-2 text-xs">
        <Plus className="h-3.5 w-3.5" /> Add Music
      </Button>

      {/* Transport + level (shown once there's a bed) */}
      {musicTracks.length > 0 && (
        <div className="rounded-lg border border-border bg-secondary/30 p-2.5 space-y-2.5">
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={toggleMusicPlayback} className="h-7 flex-1 gap-1.5 text-[11px]">
              {musicPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {musicPlaying ? 'Pause' : 'Play'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={stopMusic}
              disabled={!musicPlayingId}
              className="h-7 px-2 text-[11px]"
              title="Stop"
            >
              <Square className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant={musicLoop ? 'default' : 'ghost'}
              onClick={toggleMusicLoop}
              className="h-7 px-2 text-[11px]"
              title={musicLoop ? 'Looping current track' : 'Loop off'}
            >
              <Repeat className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant={musicMonitor ? 'default' : 'ghost'}
              onClick={toggleMusicMonitor}
              className="h-7 px-2 text-[11px]"
              title={musicMonitor ? 'Monitoring locally (you hear it)' : 'Monitor off (broadcast only)'}
            >
              <Headphones className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Slider value={[musicVolume]} onValueChange={([v]) => setMusicVolume(v)} max={100} step={1} className="flex-1" />
            <span className="text-[11px] font-mono text-muted-foreground w-9 text-right tabular-nums">{musicVolume}%</span>
          </div>
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            The slider sets the music level in the broadcast. Monitor is off by
            default so speaker music doesn't echo into your mic — use headphones,
            then turn it on to hear the bed yourself.
          </p>
        </div>
      )}

      <AddMusicDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onUploadFile={() => fileInputRef.current?.click()}
        onLoadSuno={onLoadSuno}
      />
    </div>
  );
}
