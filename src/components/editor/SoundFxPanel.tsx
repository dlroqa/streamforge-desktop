import { useCallback, useEffect, useRef, useState } from 'react';
import {
  login, logout, isLoggedIn, isConfigured, getMe, searchSounds, downloadSound,
  FreesoundAuthError, type FreesoundSound,
} from '@/lib/freesound';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Search, Loader2, Plus, Play, Pause, Volume2, LogOut } from 'lucide-react';

function formatDuration(s?: number): string | null {
  if (!s || !Number.isFinite(s)) return null;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Freesound sound-effects browser: connect account, search, preview, and
 * hand picked sounds to the host (the editor drops them in the Media bin; the
 * studio drops them in the music bed). `destinationLabel` names that target in
 * the copy so the panel reads correctly wherever it's hosted. */
export function SoundFxPanel({ onAdd, destinationLabel = 'Media bin', addLabel = 'Add to Media' }: {
  onAdd: (sound: FreesoundSound) => Promise<void>;
  destinationLabel?: string;
  addLabel?: string;
}) {
  const { toast } = useToast();
  const [authed, setAuthed] = useState(isLoggedIn);
  const [username, setUsername] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FreesoundSound[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!authed) {
      isConfigured().then(setConfigured);
      return;
    }
    getMe()
      .then(me => setUsername(me.username))
      .catch(err => { if (err instanceof FreesoundAuthError) setAuthed(false); });
  }, [authed]);

  // One shared player so starting a preview always stops the previous one.
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const stopPreview = useCallback(() => {
    audioRef.current?.pause();
    setPlayingId(null);
  }, []);

  const togglePreview = useCallback((sound: FreesoundSound) => {
    if (playingId === sound.id) { stopPreview(); return; }
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingId(null);
    }
    audioRef.current.src = sound.previews['preview-hq-mp3'];
    audioRef.current.play().catch(() => setPlayingId(null));
    setPlayingId(sound.id);
  }, [playingId, stopPreview]);

  const handleAuthError = useCallback((err: unknown): boolean => {
    if (err instanceof FreesoundAuthError) {
      setAuthed(false);
      setUsername(null);
      setResults(null);
      toast({ title: 'Freesound session expired', description: 'Please connect again.', variant: 'destructive' });
      return true;
    }
    return false;
  }, [toast]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      await login();
      setAuthed(true);
    } catch (err) {
      toast({
        title: 'Could not connect Freesound',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  }, [toast]);

  const disconnect = useCallback(() => {
    stopPreview();
    logout();
    setAuthed(false);
    setUsername(null);
    setResults(null);
  }, [stopPreview]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const pageData = await searchSounds(q, 1);
      setResults(pageData.results);
      setPage(1);
      setHasMore(pageData.hasMore);
    } catch (err) {
      if (!handleAuthError(err)) {
        toast({
          title: 'Search failed',
          description: err instanceof Error ? err.message : 'Please try again',
          variant: 'destructive',
        });
      }
    } finally {
      setSearching(false);
    }
  }, [query, toast, handleAuthError]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const pageData = await searchSounds(query.trim(), page + 1);
      setResults(prev => [...(prev ?? []), ...pageData.results]);
      setPage(p => p + 1);
      setHasMore(pageData.hasMore);
    } catch (err) {
      if (!handleAuthError(err)) {
        toast({ title: 'Could not load more', variant: 'destructive' });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [query, page, toast, handleAuthError]);

  const addSound = useCallback(async (sound: FreesoundSound) => {
    setBusyId(sound.id);
    try {
      await onAdd(sound);
    } catch (err) {
      if (!handleAuthError(err)) {
        toast({
          title: 'Could not add sound',
          description: err instanceof Error ? err.message : 'Please try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setBusyId(null);
    }
  }, [onAdd, toast, handleAuthError]);

  if (!authed) {
    return (
      <div className="flex flex-col items-center text-center gap-3 py-10 px-2">
        <Volume2 className="h-8 w-8 text-muted-foreground/50" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Freesound sound effects</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Connect your free Freesound.org account to search 600k+ community
            sound effects and drop them straight into your {destinationLabel}.
          </p>
        </div>
        {configured === false ? (
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            Freesound isn't configured yet — add the API credentials on the
            server to enable this.
          </p>
        ) : (
          <Button size="sm" onClick={connect} disabled={connecting || configured === null} className="gap-1.5">
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
            Connect Freesound
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground truncate">
          Connected{username ? <> as <span className="text-foreground font-medium">{username}</span></> : ''}
        </p>
        <button
          type="button"
          onClick={disconnect}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
        >
          <LogOut className="h-3 w-3" />Logout
        </button>
      </div>

      <div className="flex gap-1.5">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
          placeholder="Search sound effects (whoosh, swoosh, pop…)"
          className="text-xs h-8"
          maxLength={100}
        />
        <Button size="sm" onClick={runSearch} disabled={searching || !query.trim()} className="h-8 w-8 p-0 shrink-0">
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {results === null && !searching && (
        <p className="text-xs text-muted-foreground/60 text-center py-8">
          Search Freesound's community sound effects library.
        </p>
      )}
      {results?.length === 0 && (
        <p className="text-xs text-muted-foreground/60 text-center py-8">No results — try different keywords.</p>
      )}

      {!!results?.length && (
        <div className="space-y-2">
          {results.map(sound => (
            <div key={sound.id} className="rounded-md border border-border p-2 space-y-1.5 bg-secondary/30">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] text-foreground leading-tight truncate flex-1" title={sound.name}>{sound.name}</p>
                {formatDuration(sound.duration) && (
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{formatDuration(sound.duration)}</span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug truncate">
                {sound.username} · {sound.license}
              </p>
              <div className="flex gap-1">
                <Button
                  size="sm" variant="outline" className="h-6 w-6 p-0 shrink-0"
                  onClick={() => togglePreview(sound)}
                  title={playingId === sound.id ? 'Pause preview' : 'Play preview'}
                >
                  {playingId === sound.id ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </Button>
                <Button
                  size="sm" variant="outline" className="h-6 flex-1 gap-1 text-[10px] px-1"
                  disabled={busyId === sound.id}
                  onClick={() => addSound(sound)}
                  title={`Add to your ${destinationLabel}`}
                >
                  {busyId === sound.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  {addLabel}
                </Button>
              </div>
            </div>
          ))}
          {hasMore && (
            <Button size="sm" variant="outline" className="w-full h-7 text-[11px] gap-1" onClick={loadMore} disabled={loadingMore}>
              {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
              Load more
            </Button>
          )}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Sounds from Freesound.org. Check each sound's license — CC BY requires
        crediting the creator, CC BY-NC is non-commercial only.
      </p>
    </div>
  );
}
