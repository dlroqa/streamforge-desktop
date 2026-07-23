import { StudioHeader } from './StudioHeader';
import { StudioSidebar } from './StudioSidebar';
import { VideoPreview } from './VideoPreview';
import { ControlBar } from './ControlBar';
import { useStudio, type SidebarPanel } from '@/contexts/StudioContext';
import { AVSettingsPanel } from './AVSettingsPanel';
import { GraphicsPanel } from './GraphicsPanel';
import { ControlRoomPanel } from './ControlRoomPanel';
import { ArchivePanel } from './ArchivePanel';
import { InteractPanel } from './InteractPanel';
import { ProControlPanel } from './ProControlPanel';
import { TeleprompterCard } from './TeleprompterCard';
import { SlidesPanel } from './SlidesPanel';
import { StockMediaPanel } from './StockMediaPanel';
import { ScenesPanel } from './ScenesPanel';
import { GuestAudio } from './GuestAudio';
import { GammaFilterDef } from './GammaFilterDef';
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from '@/components/ui/resizable';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from 'react';
import { trackActivity } from '@/lib/userActivity';

// Carries recharts (~450KB min) — only load it when the post-stream
// summary actually opens.
const StreamAnalyticsDialog = lazy(() =>
  import('./StreamAnalyticsDialog').then(m => ({ default: m.StreamAnalyticsDialog })),
);

const panelComponents: Record<string, React.FC> = {
  pro: ProControlPanel,
  teleprompter: TeleprompterCard,
  slides: SlidesPanel,
  av: AVSettingsPanel,
  interact: InteractPanel,
  graphics: GraphicsPanel,
  controlroom: ControlRoomPanel,
  archive: ArchivePanel,
  stock: StockMediaPanel,
};

const panelTitles: Record<string, string> = {
  pro: 'Pro Control',
  teleprompter: 'Teleprompter',
  slides: 'Slides',
  av: 'Settings',
  interact: 'Invite',
  graphics: 'Graphic Interface',
  controlroom: 'Control Room',
  archive: 'Archive Tools',
  stock: 'Media Library',
};

// Panels that manage their own scrolling (e.g. a chat feed)
const selfScrollingPanels = new Set(['interact']);

// How long the open/close flex animation runs (kept in sync with the CSS
// transition below), plus a small buffer before we unmount / drop the
// transition so the motion always finishes cleanly.
const REVEAL_MS = 200;
const REVEAL_BUFFER_MS = 60;

/**
 * Drives an animated reveal for a resizable side panel: `rendered` keeps it
 * mounted through the exit, `expanded` toggles its flex-grow between 0 and its
 * real size (so the stage grows/shrinks smoothly with it), and `animating`
 * enables the flex transition ONLY around open/close — never during a manual
 * drag, which must stay instant.
 */
function usePanelReveal(open: boolean) {
  const [rendered, setRendered] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [animating, setAnimating] = useState(false);
  useEffect(() => {
    if (open) {
      setRendered(true);
      setAnimating(true);
      // Expand on the next frame so flex-grow transitions from 0 → real size.
      const raf = requestAnimationFrame(() => setExpanded(true));
      const t = setTimeout(() => setAnimating(false), REVEAL_MS + REVEAL_BUFFER_MS);
      return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    }
    setExpanded(false); // collapse (flex-grow → 0), then unmount once settled
    setAnimating(true);
    const t = setTimeout(() => { setRendered(false); setAnimating(false); }, REVEAL_MS + REVEAL_BUFFER_MS);
    return () => clearTimeout(t);
  }, [open]);
  return { rendered, expanded, animating };
}

/** Inline flex overrides that animate a panel's width open/closed. */
function revealStyle(r: { expanded: boolean; animating: boolean }): React.CSSProperties {
  return {
    ...(r.animating ? { transition: `flex-grow ${REVEAL_MS}ms ease` } : null),
    ...(r.expanded ? null : { flexGrow: 0 }),
  };
}

export function StudioLayout() {
  const {
    activePanel, setActivePanel, streamAnalytics, showAnalyticsSummary,
    dismissAnalyticsSummary, toggleMic, toggleCamera, toggleScreenShare,
    slideshow, slideNext, slidePrev, scenesOpen, setScenesOpen, orientation,
  } = useStudio();

  // Keep the control bar exactly the video's width as the stage resizes: size a
  // shared "unit" (video + control bar) to the largest broadcast frame that
  // fits. Measured with a ResizeObserver so it tracks the panel open/close
  // animation and manual drags frame-by-frame (no separate transition needed).
  const stageRef = useRef<HTMLDivElement>(null);
  const [unitWidth, setUnitWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const BAR_PX = 64; // control bar height (h-16)
    const ratio = orientation === 'portrait' ? 9 / 16 : 16 / 9; // frame width / height
    const measure = () => {
      const fit = Math.min(el.clientWidth, Math.max(0, el.clientHeight - BAR_PX) * ratio);
      setUnitWidth(fit > 0 ? fit : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [orientation]);

  // Animated reveal for both side panels — the stage (video + control bar)
  // resizes smoothly with them because the panel's flex-grow is transitioned.
  const scenes = usePanelReveal(scenesOpen);
  const side = usePanelReveal(!!activePanel);
  // Keep showing the last panel while it slides/collapses out (activePanel is
  // already null by then).
  const [renderedPanel, setRenderedPanel] = useState<SidebarPanel>(activePanel);
  useEffect(() => { if (activePanel) setRenderedPanel(activePanel); }, [activePanel]);
  const PanelComponent = renderedPanel ? panelComponents[renderedPanel] : null;

  // Activity trail for the admin panel: the studio itself, then each work
  // area (sidebar panel) as it's opened.
  useEffect(() => { trackActivity('Studio'); }, []);
  useEffect(() => {
    if (activePanel) trackActivity(panelTitles[activePanel] ?? activePanel);
  }, [activePanel]);

  // Keyboard shortcuts: M mic, C camera, S screen share, Esc close panel,
  // and ← / → to navigate a live slideshow. Skipped while typing or holding
  // modifiers.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (slideshow && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') slidePrev(); else slideNext();
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'm': toggleMic(); break;
        case 'c': toggleCamera(); break;
        case 's': toggleScreenShare(); break;
        case 'escape': setActivePanel(null); break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleMic, toggleCamera, toggleScreenShare, setActivePanel, slideshow, slideNext, slidePrev]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <StudioHeader />
      <div className="flex flex-1 overflow-hidden">
        {/* Collapsed Scenes tab — pulls the switcher out from the left edge.
            Hidden until the panel has fully collapsed away. */}
        {!scenes.rendered && (
          <button
            onClick={() => setScenesOpen(true)}
            className="shrink-0 self-start mt-4 flex items-center justify-center rounded-r-lg bg-primary text-primary-foreground py-3 px-1.5 shadow-md hover:bg-primary/90 transition-colors"
            title="Show scenes"
            aria-label="Show scenes"
          >
            {/* Vertical text flipped to read bottom-to-top (head tilts left). */}
            <span
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              className="flex items-center gap-1.5"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold tracking-wide">Show scenes</span>
            </span>
          </button>
        )}
        <ResizablePanelGroup direction="horizontal" autoSaveId="studio-layout" className="flex-1">
          {scenes.rendered && (
            <>
              <ResizablePanel id="scenes-panel" order={0} defaultSize={18} minSize={14} maxSize={32} style={revealStyle(scenes)}>
                <div className="h-full bg-card flex flex-col animate-slide-in-right">
                  <div className="flex items-center px-4 py-3 border-b border-border shrink-0">
                    <h2 className="text-sm font-semibold text-foreground">Scenes</h2>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <ScenesPanel />
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle className="w-px bg-border hover:bg-primary/40 transition-colors" />
            </>
          )}
          <ResizablePanel id="stage" order={1} defaultSize={75} minSize={50}>
            {/* The video box and control bar share one centered "unit" whose
                width tracks the fitted video, so the toolbar always matches the
                video's width and resizes with it as the panels move. */}
            <div ref={stageRef} className="relative h-full flex flex-col items-center justify-center overflow-hidden">
              {/* Hide-scenes pull-tab — lives at the stage's left edge (just
                  outside the Scenes rail, since panels clip their own overflow),
                  mirroring the Show-scenes tab that protrudes from the screen's
                  left edge. */}
              {scenes.rendered && (
                <button
                  onClick={() => setScenesOpen(false)}
                  className="absolute left-0 top-4 z-20 flex items-center justify-center rounded-r-lg bg-primary text-primary-foreground py-3 px-1.5 shadow-md hover:bg-primary/90 transition-colors"
                  title="Hide scenes"
                  aria-label="Hide scenes"
                >
                  <span
                    style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    className="flex items-center gap-1.5"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span className="text-xs font-semibold tracking-wide">Hide scenes</span>
                  </span>
                </button>
              )}
              <div
                className="flex flex-col w-full"
                style={unitWidth != null ? { width: `${unitWidth}px` } : undefined}
              >
                <VideoPreview />
                <ControlBar />
              </div>
            </div>
          </ResizablePanel>
          {side.rendered && renderedPanel && PanelComponent && (
            <>
              <ResizableHandle className="w-px bg-border hover:bg-primary/40 transition-colors" />
              <ResizablePanel id="side-panel" order={2} defaultSize={25} minSize={16} maxSize={45} style={revealStyle(side)}>
                <div className="h-full bg-card flex flex-col animate-slide-in-right">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                    <h2 className="text-sm font-semibold text-foreground">{panelTitles[renderedPanel]}</h2>
                    {/* Teleprompter closes only via its control-bar button, which
                        also clears the on-screen overlay; a header X would close
                        the panel while leaving the prompt on screen. */}
                    {renderedPanel !== 'teleprompter' && (
                      <button
                        onClick={() => setActivePanel(null)}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        title="Close panel (Esc)"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div
                    className={
                      selfScrollingPanels.has(renderedPanel)
                        ? 'flex-1 overflow-hidden'
                        : 'flex-1 overflow-y-auto p-4'
                    }
                  >
                    <PanelComponent />
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        <StudioSidebar />
      </div>

      {showAnalyticsSummary && (
        <Suspense fallback={null}>
          <StreamAnalyticsDialog
            open={showAnalyticsSummary}
            onClose={dismissAnalyticsSummary}
            analytics={streamAnalytics}
          />
        </Suspense>
      )}

      {/* Hidden sinks so the host hears guests */}
      <GuestAudio />

      {/* Shared SVG gamma filter (referenced by preview CSS and compositor canvas) */}
      <GammaFilterDef />
    </div>
  );
}
