import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { classifyVideoUrl, isLikelyVideoUrl, PLATFORM_LABEL, type VideoContainer } from '@/lib/videoCut';
import { Loader2, Scissors } from 'lucide-react';

const FORMATS: VideoContainer[] = ['mp4', 'webm'];

/** "Video Cut" — paste an X (Twitter) or Facebook link (via the backend
 * resolver) or a direct video URL to load it into the editor as a trimmable clip. */
export function VideoCutDialog({
  open, onOpenChange, onLoad,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Resolve + add the URL to the Media bin; throws on failure. */
  onLoad: (url: string, format: VideoContainer) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<VideoContainer>('mp4');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind = isLikelyVideoUrl(url) ? classifyVideoUrl(url) : null;
  const unsupported = kind === 'youtube' || kind === 'rumble';
  const valid = !!kind && !unsupported;
  // Format only matters when the backend resolver does the fetch; a direct file
  // URL is loaded as-is.
  const showFormat = valid && kind !== 'direct';

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    try {
      await onLoad(url.trim(), format);
      setUrl('');
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that video.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!loading) { onOpenChange(v); if (!v) setError(null); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Scissors className="h-4 w-4 text-primary" /> Video Cut
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Paste an <span className="font-medium">X (Twitter)</span> or <span className="font-medium">Facebook</span> link
            to load it into the editor as a trimmable clip.
            Direct<span className="font-mono"> .mp4/.webm </span>URLs load right away. YouTube and Rumble aren't supported.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            autoFocus
            value={url}
            onChange={e => { setUrl(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="https://x.com/…  ·  facebook.com/…  ·  …/clip.mp4"
            className="text-sm"
            disabled={loading}
          />
          {unsupported && (
            <p className="text-[11px] text-destructive leading-relaxed">
              {kind === 'youtube' ? 'YouTube' : 'Rumble'} isn't supported (it blocks datacenter downloads). Use an X or Facebook link, or a direct .mp4/.webm URL.
            </p>
          )}
          {valid && kind === 'direct' && (
            <p className="text-[11px] text-muted-foreground">Direct video file — loads immediately.</p>
          )}
          {valid && (kind === 'twitter' || kind === 'facebook') && (
            <p className="text-[11px] text-muted-foreground">{PLATFORM_LABEL[kind]} link — fetched through your Video Cut resolver.</p>
          )}
          {valid && kind === 'other' && (
            <p className="text-[11px] text-muted-foreground">Link — will be sent to your resolver (best-effort; supported sites only).</p>
          )}

          {showFormat && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] text-muted-foreground">Format</span>
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                {FORMATS.map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    disabled={loading}
                    className={`px-2.5 py-1 text-[11px] font-medium uppercase transition-colors ${
                      format === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground/70">
                {format === 'webm' ? 'matches editor export' : 'most compatible'}
              </span>
            </div>
          )}

          {error && <p className="text-[11px] text-destructive leading-relaxed">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!valid || loading} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
            {loading ? 'Loading…' : 'Load into editor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
