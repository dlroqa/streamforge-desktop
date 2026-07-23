import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { classifySunoUrl, resolveSunoTracks, type SunoTrack } from '@/lib/suno';
import { Loader2, Music4, ArrowLeft, Upload, ChevronRight, Volume2 } from 'lucide-react';

/** "Add Music" — one entry point to put audio on the timeline, either by
 * uploading a file (music / voiceover) or by loading from a Suno song, share,
 * or playlist link. */
export function AddMusicDialog({
  open, onOpenChange, onUploadFile, onLoadSuno, onOpenSoundFx,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Open the file picker (upload handled by the host's hidden input). */
  onUploadFile: () => void;
  /** Fetch + add the chosen Suno tracks to the audio track; throws on failure. */
  onLoadSuno: (tracks: SunoTrack[]) => Promise<void>;
  /** Open the Sound Fx browser (editor-only; the studio omits this). */
  onOpenSoundFx?: () => void;
}) {
  const [screen, setScreen] = useState<'choice' | 'suno'>('choice');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When a playlist resolves, we show a picker instead of loading immediately.
  const [picker, setPicker] = useState<{ name: string; tracks: SunoTrack[] } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const kind = url.trim() ? classifySunoUrl(url) : null;
  const valid = kind === 'song' || kind === 'short' || kind === 'playlist';

  const reset = () => {
    setScreen('choice'); setUrl(''); setError(null); setPicker(null); setChosen(new Set());
  };
  const close = () => { if (!loading) { onOpenChange(false); setTimeout(reset, 200); } };

  const pickUpload = () => { onUploadFile(); close(); };

  const resolve = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await resolveSunoTracks(url.trim());
      if (result.type === 'playlist') {
        setPicker({ name: result.name, tracks: result.tracks });
        setChosen(new Set(result.tracks.map(t => t.id)));
      } else {
        await onLoadSuno(result.tracks);
        close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that Suno link.');
    } finally {
      setLoading(false);
    }
  };

  const addChosen = async () => {
    if (!picker || loading) return;
    const tracks = picker.tracks.filter(t => chosen.has(t.id));
    if (!tracks.length) return;
    setLoading(true);
    setError(null);
    try {
      await onLoadSuno(tracks);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add those songs.');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: string) =>
    setChosen(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={v => (v ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Music4 className="h-4 w-4 text-primary" /> Add Music
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {screen === 'choice'
              ? 'Add audio to your timeline — upload a file, or load music from Suno.'
              : picker
                ? `“${picker.name}” — pick the songs to add to your audio track.`
                : 'Paste a Suno song, share, or playlist link. No login needed — open your music on Suno, copy the link, and paste it here.'}
          </DialogDescription>
        </DialogHeader>

        {screen === 'choice' ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={pickUpload}
              className="w-full flex items-center gap-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 px-3 py-2.5 text-left transition-colors"
            >
              <Upload className="h-4 w-4 text-primary shrink-0" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-foreground">Upload a file</span>
                <span className="block text-[11px] text-muted-foreground">Music or voiceover from your device</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => { setScreen('suno'); setError(null); }}
              className="w-full flex items-center gap-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 px-3 py-2.5 text-left transition-colors"
            >
              <Music4 className="h-4 w-4 text-primary shrink-0" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-foreground">From Suno</span>
                <span className="block text-[11px] text-muted-foreground">Load a song, share, or playlist link</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
            {onOpenSoundFx && (
              <button
                type="button"
                onClick={() => { onOpenSoundFx(); close(); }}
                className="w-full flex items-center gap-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 px-3 py-2.5 text-left transition-colors"
              >
                <Volume2 className="h-4 w-4 text-primary shrink-0" />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-foreground">Sound Fx</span>
                  <span className="block text-[11px] text-muted-foreground">Search &amp; download effects from Freesound</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            )}
          </div>
        ) : !picker ? (
          <div className="space-y-2">
            <Input
              autoFocus
              value={url}
              onChange={e => { setUrl(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') resolve(); }}
              placeholder="https://suno.com/song/…  ·  /s/…  ·  /playlist/…"
              className="text-sm"
              disabled={loading}
            />
            {valid && kind === 'song' && (
              <p className="text-[11px] text-muted-foreground">Suno song — loads onto your audio track.</p>
            )}
            {valid && kind === 'short' && (
              <p className="text-[11px] text-muted-foreground">Suno share link — resolved to its song.</p>
            )}
            {valid && kind === 'playlist' && (
              <p className="text-[11px] text-muted-foreground">Suno playlist — you'll pick which songs to add.</p>
            )}
            {kind === 'invalid' && (
              <p className="text-[11px] text-muted-foreground">Paste a Suno song, /s/ share, or /playlist/ link.</p>
            )}
            {error && <p className="text-[11px] text-destructive leading-relaxed">{error}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{chosen.size} of {picker.tracks.length} selected</span>
              <button
                type="button"
                className="hover:text-foreground transition-colors"
                onClick={() => setChosen(chosen.size === picker.tracks.length ? new Set() : new Set(picker.tracks.map(t => t.id)))}
              >
                {chosen.size === picker.tracks.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {picker.tracks.map(t => (
                <label key={t.id} className="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer hover:bg-secondary/50">
                  <Checkbox checked={chosen.has(t.id)} onCheckedChange={() => toggle(t.id)} disabled={loading} />
                  <span className="text-xs text-foreground truncate">{t.title}</span>
                </label>
              ))}
            </div>
            {error && <p className="text-[11px] text-destructive leading-relaxed">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {screen === 'choice' ? (
            <Button variant="outline" size="sm" onClick={close}>Cancel</Button>
          ) : picker ? (
            <>
              <Button variant="outline" size="sm" onClick={() => { setPicker(null); setError(null); }} disabled={loading} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button size="sm" onClick={addChosen} disabled={loading || chosen.size === 0} className="gap-1.5">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music4 className="h-3.5 w-3.5" />}
                {loading ? 'Adding…' : `Add ${chosen.size} song${chosen.size === 1 ? '' : 's'}`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => { setScreen('choice'); setError(null); }} disabled={loading} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button size="sm" onClick={resolve} disabled={!valid || loading} className="gap-1.5">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music4 className="h-3.5 w-3.5" />}
                {loading ? 'Loading…' : 'Load into editor'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
