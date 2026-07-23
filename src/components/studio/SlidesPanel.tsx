import { useEffect, useRef, useState } from 'react';
import { Presentation, Upload, Trash2, Play, Square, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Progress } from '@/components/ui/progress';
import { useStudio } from '@/contexts/StudioContext';
import { useToast } from '@/hooks/use-toast';
import {
  listSlides, addSlide, removeSlide, slideFile, renderAllPages,
  loadPageThumbs, savePageThumbs,
  MAX_SLIDES, type SlideDoc, type PageThumb,
} from '@/lib/slidesLibrary';

const titleOf = (name: string) => name.replace(/\.pdf$/i, '');

/**
 * Slides — a per-account PDF deck library. Upload a deck (PDF) and it's stored
 * against the signed-in account, previewed as a thumbnail above the upload
 * button, and presentable to the broadcast with one click. Holds up to
 * MAX_SLIDES decks.
 */
export function SlidesPanel() {
  const { slideshow, loadSlideshow, closeSlideshow, slideGoTo } = useStudio();
  const { toast } = useToast();

  const [docs, setDocs] = useState<SlideDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Per-slide picker: which deck is expanded, its rendered page thumbnails
  // (session-cached by deck id), and whether a render is still streaming in.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pageThumbs, setPageThumbs] = useState<Record<string, PageThumb[]>>({});
  const [pagesBusy, setPagesBusy] = useState<Record<string, boolean>>({});
  const cancelRef = useRef<Record<string, { cancelled: boolean }>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const cancels = cancelRef.current; // stable object; we only mutate its members
    let alive = true;
    listSlides()
      .then(list => { if (alive) setDocs(list); })
      .catch(() => { /* signed-out or offline — leave the library empty */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => {
      alive = false;
      mountedRef.current = false;
      // Stop any in-flight page renders when the panel closes.
      Object.values(cancels).forEach(t => { t.cancelled = true; });
    };
  }, []);

  const loadPages = async (doc: SlideDoc) => {
    const token = { cancelled: false };
    cancelRef.current[doc.id] = token;
    setPagesBusy(b => ({ ...b, [doc.id]: true }));
    setPageThumbs(t => ({ ...t, [doc.id]: [] }));
    try {
      // Rendered before? Load the saved thumbnails whole — no re-render.
      const saved = await loadPageThumbs(doc);
      if (token.cancelled || !mountedRef.current) return;
      if (saved && saved.length === doc.pages) {
        setPageThumbs(t => ({ ...t, [doc.id]: saved }));
        return;
      }
      // First time on this account/device — render every page, then persist so
      // future sessions skip it.
      const rendered: PageThumb[] = [];
      await renderAllPages(doc, pt => {
        if (token.cancelled || !mountedRef.current) return;
        rendered.push(pt);
        setPageThumbs(t => ({ ...t, [doc.id]: [...(t[doc.id] ?? []), pt] }));
      }, token);
      if (!token.cancelled && rendered.length === doc.pages) {
        void savePageThumbs(doc, rendered);
      }
    } catch (err) {
      if (!token.cancelled) {
        toast({
          title: 'Couldn’t load slides',
          description: err instanceof Error ? err.message : 'Render failed',
          variant: 'destructive',
        });
      }
    } finally {
      if (mountedRef.current) setPagesBusy(b => ({ ...b, [doc.id]: false }));
    }
  };

  const toggleExpand = (doc: SlideDoc) => {
    if (expandedId === doc.id) { setExpandedId(null); return; }
    setExpandedId(doc.id);
    if (!pageThumbs[doc.id]) void loadPages(doc); // render once, then session-cached
  };

  // Present the deck (if not already live) and jump straight to a page.
  const jumpTo = async (doc: SlideDoc, page: number) => {
    const live = !!slideshow && slideshow.title === titleOf(doc.name);
    if (live) { slideGoTo(page); return; }
    setBusyId(doc.id);
    try {
      const error = await loadSlideshow(await slideFile(doc));
      if (error) { toast({ title: 'Couldn’t present', description: error, variant: 'destructive' }); return; }
      slideGoTo(page);
    } catch (err) {
      toast({
        title: 'Couldn’t present',
        description: err instanceof Error ? err.message : 'Load failed',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setUploadPct(0);
    try {
      setDocs(await addSlide(file, f => setUploadPct(Math.round(f * 100))));
    } catch (err) {
      toast({
        title: 'Couldn’t add slides',
        description: err instanceof Error ? err.message : 'Upload failed',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (file) void uploadFile(file);
  };

  // Drop a file onto the safe zone to upload it straight away. addSlide()
  // validates the type, so a non-PDF drop surfaces a readable toast.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (uploading || docs.length >= MAX_SLIDES) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  };

  const present = async (doc: SlideDoc) => {
    setBusyId(doc.id);
    try {
      const error = await loadSlideshow(await slideFile(doc));
      if (error) toast({ title: 'Couldn’t present', description: error, variant: 'destructive' });
    } catch (err) {
      toast({
        title: 'Couldn’t present',
        description: err instanceof Error ? err.message : 'Load failed',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (doc: SlideDoc) => {
    setBusyId(doc.id);
    try {
      if (slideshow && slideshow.title === titleOf(doc.name)) closeSlideshow();
      setDocs(await removeSlide(doc.id));
      if (cancelRef.current[doc.id]) cancelRef.current[doc.id].cancelled = true;
      if (expandedId === doc.id) setExpandedId(null);
      setPageThumbs(t => { const next = { ...t }; delete next[doc.id]; return next; });
    } catch (err) {
      toast({
        title: 'Couldn’t remove',
        description: err instanceof Error ? err.message : 'Delete failed',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const full = docs.length >= MAX_SLIDES;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Presentation className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-foreground">Slides</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Upload PDF decks (export PowerPoint, Keynote, or Google Slides to PDF).
          They’re saved to your account and ready to present. Up to {MAX_SLIDES} decks.
        </p>

        {/* Saved decks — previews sit above the upload button */}
        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading your decks…</span>
          </div>
        ) : docs.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-3 text-center">
            No decks yet — upload a PDF below.
          </p>
        ) : (
          <div className="space-y-2">
            {docs.map(doc => {
              const live = !!slideshow && slideshow.title === titleOf(doc.name);
              const busy = busyId === doc.id;
              const expanded = expandedId === doc.id;
              const thumbs = pageThumbs[doc.id] ?? [];
              const rendering = pagesBusy[doc.id];
              return (
                <div key={doc.id} className="rounded-md border border-border overflow-hidden bg-background/60">
                  <div className="group relative">
                    <button
                      onClick={() => (live ? closeSlideshow() : present(doc))}
                      disabled={busy}
                      className="block w-full aspect-video relative"
                      title={live ? 'Stop presenting' : `Present ${titleOf(doc.name)}`}
                    >
                      <img src={doc.thumb} alt="" className="w-full h-full object-contain bg-black/40" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        {busy
                          ? <Loader2 className="h-6 w-6 text-white animate-spin" />
                          : live
                            ? <Square className="h-6 w-6 text-white" />
                            : <Play className="h-6 w-6 text-white" />}
                      </span>
                      {live && (
                        <span className="absolute top-1 left-1 text-[9px] font-semibold uppercase tracking-wider bg-live text-white rounded px-1 py-0.5">
                          Live
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-1 px-1.5 py-1">
                    <span className="flex-1 min-w-0 truncate text-[11px] text-foreground" title={doc.name}>
                      {titleOf(doc.name)}
                    </span>
                    {/* Page count doubles as the "jump to a slide" expander */}
                    <button
                      onClick={() => toggleExpand(doc)}
                      title={expanded ? 'Hide slides' : 'Pick a slide'}
                      aria-expanded={expanded}
                      className="shrink-0 flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      {doc.pages}p
                      <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                    <button
                      onClick={() => remove(doc)}
                      disabled={busy}
                      title="Remove deck"
                      className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Per-slide picker — jump straight to any slide */}
                  {expanded && (
                    <div className="border-t border-border p-1.5 space-y-2">
                      {rendering && (
                        <div className="px-0.5 pt-0.5">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                            <span>Rendering slides…</span>
                            <span>{thumbs.length}/{doc.pages}</span>
                          </div>
                          <Progress
                            value={Math.round((thumbs.length / Math.max(doc.pages, 1)) * 100)}
                            className="h-1.5"
                          />
                        </div>
                      )}
                      {thumbs.length > 0 && (
                        <>
                          <div className="grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto">
                            {thumbs.map(pt => {
                              const current = live && slideshow?.current === pt.page;
                              return (
                                <HoverCard key={pt.page} openDelay={120} closeDelay={80}>
                                  <HoverCardTrigger asChild>
                                    <button
                                      onClick={() => jumpTo(doc, pt.page)}
                                      disabled={busy}
                                      title={`Go to slide ${pt.page}`}
                                      className={`group/pg relative rounded border overflow-hidden transition-colors ${
                                        current ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/60'
                                      }`}
                                    >
                                      <img src={pt.thumb} alt="" className="w-full aspect-video object-contain bg-black/40" />
                                      <span className="absolute bottom-0.5 right-0.5 text-[8px] font-medium bg-black/70 text-white rounded px-1 leading-tight">
                                        {pt.page}
                                      </span>
                                    </button>
                                  </HoverCardTrigger>
                                  {/* Enlarged preview so a slide can be found by sight, not by clicking */}
                                  <HoverCardContent side="left" align="center" sideOffset={10} className="w-72 p-1.5">
                                    <img src={pt.thumb} alt="" className="w-full aspect-video object-contain bg-black/40 rounded" />
                                    <p className="text-[11px] text-center text-muted-foreground pt-1">
                                      Slide {pt.page} of {doc.pages}
                                    </p>
                                  </HoverCardContent>
                                </HoverCard>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Safe zone — drop a file inside the outline to upload it right away */}
        <div
          onDragOver={e => { e.preventDefault(); if (!uploading && !full) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => { if (!uploading && !full) inputRef.current?.click(); }}
          role="button"
          aria-label="Drag and drop files here to upload"
          className={`rounded-lg border-2 border-dashed px-3 py-6 flex flex-col items-center justify-center gap-2 text-center transition-colors ${
            uploading || full
              ? 'opacity-50 pointer-events-none border-border'
              : 'cursor-pointer ' + (dragOver
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50 bg-background/40')
          }`}
        >
          <Upload className={`h-5 w-5 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
          <span className={`text-[11px] ${dragOver ? 'text-primary' : 'text-muted-foreground'}`}>
            Drag and drop files here
          </span>
        </div>

        {uploading ? (
          <div className="space-y-1.5 py-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Uploading…</span>
              <span className="tabular-nums">{uploadPct}%</span>
            </div>
            <Progress value={uploadPct} className="h-2" />
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={full}
            className="w-full gap-2"
          >
            <Upload className="h-3.5 w-3.5" /> Upload PDF
          </Button>
        )}
        {full && (
          <p className="text-[11px] text-muted-foreground text-center">
            Library full ({docs.length}/{MAX_SLIDES}) — remove a deck to add another.
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFile}
          className="hidden"
        />
      </div>
    </div>
  );
}
