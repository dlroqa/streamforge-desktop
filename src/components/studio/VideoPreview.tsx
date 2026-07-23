import { useStudio, lowerThirdFontStack, type LogoOverlay, type ParsedLut, type LowerThird } from '@/contexts/StudioContext';
import { buildFilterCss, type ColorGrade } from '@/lib/streamCompositor';
import { LutRenderer } from '@/lib/lut';
import { useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';
import { TeleprompterOverlay } from './TeleprompterOverlay';
import { StageLayoutRail } from './StageLayoutRail';

/** Pre-live main view with the LUT applied: frames run through the same
 * WebGL LUT processor the broadcast uses, so Cue on/off is visible before
 * going live (CSS alone cannot render 3D LUTs). */
function LutPreviewCanvas({ stream, lut, filter, cover, mirror }: {
  stream: MediaStream;
  lut: ParsedLut;
  filter: string;
  cover: boolean;
  mirror?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fallbackVideoRef = useRef<HTMLVideoElement>(null);
  // When the WebGL stage can't run (or renders black), keep showing the
  // ungraded video rather than a blank frame
  const [glFailed, setGlFailed] = useState(false);

  // A different LUT deserves a fresh attempt
  useEffect(() => { setGlFailed(false); }, [lut]);

  useEffect(() => {
    if (glFailed) {
      const v = fallbackVideoRef.current;
      if (v && v.srcObject !== stream) {
        v.srcObject = stream;
        v.play().catch(() => { /* autoplay handles it */ });
      }
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let raf = 0;
    let canvasMounted = false;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;
    video.play().catch(() => { /* tick loop tolerates missing frames */ });

    let renderer: LutRenderer | null = null;
    try {
      renderer = new LutRenderer();
      renderer.setLut(lut);
      if (!renderer.selfTest()) throw new Error('LUT self-test rendered black');
    } catch (err) {
      console.error('LUT preview disabled — showing ungraded video:', err);
      renderer?.dispose();
      video.srcObject = null;
      setGlFailed(true);
      return;
    }

    const tick = () => {
      if (disposed) return;
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          const canvas = renderer!.process(video, video.videoWidth, video.videoHeight);
          if (!canvasMounted) {
            canvas.className = `w-full h-full bg-background ${cover ? 'object-cover' : 'object-contain'}`;
            host.appendChild(canvas);
            canvasMounted = true;
          }
        } catch (err) {
          console.error('LUT processing stopped — showing ungraded video:', err);
          setGlFailed(true);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      video.srcObject = null;
      while (host.firstChild) host.removeChild(host.firstChild);
      renderer?.dispose();
    };
  }, [stream, lut, cover, glFailed]);

  if (glFailed) {
    return (
      <video
        ref={fallbackVideoRef}
        autoPlay
        muted
        playsInline
        className={`w-full h-full bg-background ${cover ? 'object-cover' : 'object-contain'}`}
        style={{ filter: filter || undefined }}
      />
    );
  }
  return <div ref={hostRef} className={`w-full h-full ${mirror ? '-scale-x-100' : ''}`} style={{ filter: filter || undefined }} />;
}

/** Pre-live logo overlay — drag it anywhere; position maps to the broadcast. */
function DraggableLogo({ logo, onMove }: { logo: LogoOverlay; onMove: (x: number, y: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const container = wrapRef.current?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      onMove(
        Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      );
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, onMove]);

  return (
    <div
      ref={wrapRef}
      onPointerDown={e => { e.preventDefault(); setDragging(true); }}
      className={`absolute z-20 select-none touch-none ${dragging ? 'cursor-grabbing ring-2 ring-primary/60 rounded' : 'cursor-grab'}`}
      style={{
        left: `${logo.x * 100}%`,
        top: `${logo.y * 100}%`,
        width: `${logo.scale * 100}%`,
        transform: 'translate(-50%, -50%)',
        opacity: logo.opacity / 100,
      }}
      title="Drag to reposition"
    >
      {logo.kind === 'video' ? (
        <video src={logo.url} autoPlay loop muted playsInline className="w-full pointer-events-none" />
      ) : (
        <img src={logo.url} alt="Logo" className="w-full pointer-events-none" draggable={false} />
      )}
    </div>
  );
}

/** Color multiply / color add blend overlays (preview mirror of the
 * compositor's canvas blends). plus-lighter = additive blending. */
function GradeBlendOverlays({ grade }: { grade: ColorGrade }) {
  return (
    <>
      {grade.multiplyEnabled && (
        <div
          className="absolute inset-0 pointer-events-none z-[5]"
          style={{ backgroundColor: grade.multiplyColor, mixBlendMode: 'multiply' }}
        />
      )}
      {grade.addEnabled && (
        <div
          className="absolute inset-0 pointer-events-none z-[5]"
          style={{ backgroundColor: grade.addColor, mixBlendMode: 'plus-lighter' }}
        />
      )}
    </>
  );
}

/** Draggable PiP stack — the camera tile(s) can be dropped anywhere in the
 * frame; position maps 1:1 to the broadcast compositor. Clamped so the tile
 * never leaves the frame. */
function DraggablePipStack({ position, onMove, children }: {
  position: { x: number; y: number };
  onMove: (p: { x: number; y: number }) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const grab = useRef({ dx: 0, dy: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const el = ref.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    const move = (e: PointerEvent) => {
      const cr = container.getBoundingClientRect();
      const tr = el.getBoundingClientRect();
      const maxX = Math.max(0, 1 - tr.width / cr.width);
      const maxY = Math.max(0, 1 - tr.height / cr.height);
      onMove({
        x: Math.max(0, Math.min(maxX, (e.clientX - grab.current.dx - cr.left) / cr.width)),
        y: Math.max(0, Math.min(maxY, (e.clientY - grab.current.dy - cr.top) / cr.height)),
      });
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, onMove]);

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      className={`absolute z-10 w-[22%] flex flex-col gap-2 select-none touch-none ${
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
      title="Drag to reposition"
    >
      {children}
    </div>
  );
}

/** Draggable lower-third overlay on the preview stage. Renders the cued lower
 * third (permanent look) or a temporary, ghosted placeholder for the item being
 * edited — cueing is what actually bakes it into the broadcast. Accent bar runs
 * along the bottom. */
function LowerThirdOverlay({ data, isTemp, dragging, dragRef, onPointerDown }: {
  data: LowerThird;
  isTemp: boolean;
  dragging: boolean;
  dragRef: React.RefObject<HTMLDivElement>;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const s = data.style;
  const stack = lowerThirdFontStack(s.font);
  const textOnly = s.shape !== 'rounded' && s.shape !== 'pill';
  const radius = s.shape === 'pill' ? 999 : 12;
  const textStyle = {
    fontFamily: stack,
    textAlign: s.align,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: s.underline ? 'underline' : 'none',
    ...(textOnly ? { textShadow: '0 2px 10px rgba(0,0,0,0.75)' } : {}),
  } as const;

  return (
    <div
      ref={dragRef}
      onPointerDown={onPointerDown}
      className={`absolute z-10 select-none touch-none w-1/2 ${
        dragging ? 'cursor-grabbing ring-2 ring-primary/50 rounded' : 'cursor-grab animate-fade-in'
      }`}
      style={{
        left: `${s.x * 100}%`,
        top: `${s.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        opacity: isTemp ? 0.6 : 1,
      }}
      title="Drag to reposition"
    >
      {isTemp && (
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] uppercase tracking-wider text-primary font-semibold bg-background/70 px-1.5 py-0.5 rounded">
          Preview · cue to broadcast
        </div>
      )}
      <div
        className={textOnly ? 'relative' : 'backdrop-blur-sm overflow-hidden relative'}
        style={textOnly ? { padding: '12px 24px 16px' } : {
          backgroundColor: `${s.bgColor}F2`,
          borderRadius: radius,
          padding: '12px 24px 16px',
          ...(isTemp ? { outline: '1px dashed rgba(120,130,160,0.6)' } : {}),
        }}
      >
        {!textOnly && (
          <div
            className="absolute left-0 right-0 bottom-0 h-1.5"
            style={{ backgroundColor: s.accentColor }}
          />
        )}
        <h3 className="leading-tight" style={{ ...textStyle, color: s.textColor, fontSize: s.titleSize * 0.6 }}>
          {data.title}
        </h3>
        {data.subtitle && (
          <p className="mt-0.5" style={{ ...textStyle, color: `${s.textColor}BF`, fontSize: s.subtitleSize * 0.6, fontWeight: s.bold ? 600 : 400 }}>
            {data.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

export function VideoPreview() {
  const {
    cameraStream, screenStream, camera2Stream, isCameraOn, isCamera2On, isScreenSharing,
    activeFilter, colorGrade, lowerThird, isLive, isRecording, isBackstage,
    polls, questions, compositeStream, logo, updateLogo,
    activeLowerThirdId, updateLowerThirdItem, orientation,
    previewLowerThird, previewLowerThirdId,
    lut, lutEnabled, pipPosition, setPipPosition,
    guests, guestLayout, setGuestLayout,
    mirrorPreview, program,
  } = useStudio();

  // Self-view mirror is a camera-only convenience — never flip a shared screen.
  const showMirror = mirrorPreview && !isScreenSharing;

  // The cued lower third renders permanently; the item being edited (but not
  // cued) renders as a temporary ghost so its placement can be seen/positioned
  // before going to air. Only one is shown at a time.
  const cuedLt = lowerThird.visible && lowerThird.title ? lowerThird : null;
  const editingCued = previewLowerThirdId != null && previewLowerThirdId === activeLowerThirdId;
  const tempLt = previewLowerThird.visible && previewLowerThird.title && !editingCued
    ? previewLowerThird : null;
  const shownLt = tempLt ?? cuedLt;
  const shownLtIsTemp = !!tempLt;
  const dragLtId = shownLtIsTemp ? previewLowerThirdId : activeLowerThirdId;

  // Drag state for the lower third overlay
  const [ltDragging, setLtDragging] = useState(false);
  const ltRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ltDragging || !dragLtId) return;
    const container = ltRef.current?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      updateLowerThirdItem(dragLtId, {
        style: {
          x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
        } as Parameters<typeof updateLowerThirdItem>[1]['style'],
      });
    };
    const up = () => setLtDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [ltDragging, dragLtId, updateLowerThirdItem]);

  const ltPointerDown = (e: React.PointerEvent) => { e.preventDefault(); setLtDragging(true); };

  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const pip2VideoRef = useRef<HTMLVideoElement>(null);
  const compositeVideoRef = useRef<HTMLVideoElement>(null);

  // Main source: honor the Scenes switcher's forced program when set (so a solo
  // host sees the cut in this idle preview too), else fall back to the
  // compositor's priority: screen > cam 1 > cam 2.
  const programStream =
    program === 'camera1' ? (isCameraOn ? cameraStream : null) :
    program === 'camera2' ? (isCamera2On ? camera2Stream : null) :
    program === 'screen' ? (isScreenSharing ? screenStream : null) :
    null;
  const mainStream = programStream ?? (isScreenSharing
    ? screenStream
    : (isCameraOn && cameraStream) || (isCamera2On && camera2Stream) || null);
  const pipStream = isScreenSharing && isCameraOn ? cameraStream : null;
  const pip2Stream = isCamera2On && camera2Stream && mainStream !== camera2Stream ? camera2Stream : null;

  // lut/lutEnabled are deps because cueing the LUT off swaps the WebGL canvas
  // back for a freshly mounted <video> that needs the stream re-attached
  useEffect(() => {
    if (mainVideoRef.current && mainVideoRef.current.srcObject !== mainStream) {
      mainVideoRef.current.srcObject = mainStream;
    }
  }, [mainStream, lut, lutEnabled]);

  useEffect(() => {
    if (pip2VideoRef.current) {
      pip2VideoRef.current.srcObject = pip2Stream;
    }
  }, [pip2Stream]);

  useEffect(() => {
    if (compositeVideoRef.current) {
      compositeVideoRef.current.srcObject = compositeStream;
    }
  }, [compositeStream]);

  useEffect(() => {
    if (pipVideoRef.current) {
      pipVideoRef.current.srcObject = pipStream;
    }
  }, [pipStream]);

  const activePoll = polls.find(p => p.active);
  const highlightedQuestion = questions.find(q => q.highlighted);
  const totalVotes = activePoll?.options.reduce((sum, o) => sum + o.votes, 0) || 0;

  // The stage is the broadcast frame (16:9 landscape, 9:16 portrait). Its WIDTH
  // is set by the parent "unit" wrapper (which sizes the video + control bar to
  // the largest frame that fits and keeps the toolbar exactly the video's
  // width); here we just hold that width and derive the height from the aspect.
  const outerClass = orientation === 'portrait'
    ? 'relative w-full aspect-[9/16] bg-background overflow-hidden shadow-2xl'
    : 'relative w-full aspect-video bg-background overflow-hidden';
  const stageClass = 'relative w-full h-full overflow-hidden';

  // While broadcasting, preview the actual composited output (filters,
  // overlays, and guest tiles baked in) — exactly what viewers receive.
  if (compositeStream) {
    return (
      <div className={outerClass}>
        <div className={stageClass}>
        <div className="absolute top-3 left-3 z-20 flex gap-2">
          {isLive && (
            <div className="flex items-center gap-1.5 bg-live text-live-foreground px-2.5 py-1 rounded-md text-[11px] font-bold tracking-widest shadow-lg">
              <span className="h-1.5 w-1.5 rounded-full bg-live-foreground animate-pulse-live" />
              LIVE
            </div>
          )}
          {!isLive && isBackstage && (
            <div className="flex items-center gap-1.5 bg-primary/90 text-primary-foreground px-2.5 py-1 rounded-md text-[11px] font-bold tracking-widest shadow-lg">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
              WAITING ROOM · NOT BROADCASTING
            </div>
          )}
          {isRecording && (
            <div className="flex items-center gap-1.5 bg-destructive text-destructive-foreground px-2.5 py-1 rounded-md text-[11px] font-bold tracking-widest shadow-lg">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground animate-pulse-live" />
              REC
            </div>
          )}
        </div>
        <video
          ref={compositeVideoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-contain bg-background"
        />
        {/* Only the temporary (uncued) placeholder — the cued one is already in
            the composite feed, so we don't double it. */}
        {tempLt && (
          <LowerThirdOverlay
            data={tempLt}
            isTemp
            dragging={ltDragging}
            dragRef={ltRef}
            onPointerDown={ltPointerDown}
          />
        )}
        {/* Scene layout rail — Split / PiP / Solo for the broadcast composite */}
        {guests.length > 0 && (
          <StageLayoutRail value={guestLayout} onChange={setGuestLayout} />
        )}
        <TeleprompterOverlay />
        </div>
      </div>
    );
  }

  return (
    <div className={outerClass}>
      <div className={stageClass}>
      {/* Status badges */}
      <div className="absolute top-3 left-3 z-20 flex gap-2">
        {isLive && (
          <div className="flex items-center gap-1.5 bg-live text-live-foreground px-2.5 py-1 rounded-md text-[11px] font-bold tracking-widest shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-live-foreground animate-pulse-live" />
            LIVE
          </div>
        )}
        {isRecording && (
          <div className="flex items-center gap-1.5 bg-destructive text-destructive-foreground px-2.5 py-1 rounded-md text-[11px] font-bold tracking-widest shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground animate-pulse-live" />
            REC
          </div>
        )}
      </div>

      {/* Main video (through the WebGL LUT processor when a LUT is cued) */}
      {mainStream ? (
        <>
          {lut && lutEnabled ? (
            <LutPreviewCanvas
              stream={mainStream}
              lut={lut}
              filter={buildFilterCss(activeFilter, colorGrade) || ''}
              cover={orientation === 'portrait' && !isScreenSharing}
              mirror={showMirror}
            />
          ) : (
            <video
              ref={mainVideoRef}
              autoPlay
              muted
              playsInline
              className={`w-full h-full bg-background ${
                orientation === 'portrait' && !isScreenSharing ? 'object-cover' : 'object-contain'
              } ${showMirror ? '-scale-x-100' : ''}`}
              style={{ filter: buildFilterCss(activeFilter, colorGrade) || '' }}
            />
          )}
          <GradeBlendOverlays grade={colorGrade} />
        </>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-secondary/50 flex items-center justify-center">
            <VideoOff className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-sm font-medium">No video source active</p>
            <p className="text-muted-foreground/50 text-xs mt-1">
              Open <span className="text-primary">Sources</span> panel or use controls below
            </p>
          </div>
        </div>
      )}

      {/* PiP camera overlays — drag anywhere; position maps to the broadcast */}
      {(pipStream || pip2Stream) && (
        <DraggablePipStack position={pipPosition} onMove={setPipPosition}>
          {pipStream && (
            <div className="w-full aspect-video rounded-lg overflow-hidden border-2 border-primary/40 shadow-2xl">
              <video
                ref={pipVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover pointer-events-none"
                style={{ filter: buildFilterCss(activeFilter, colorGrade) || '' }}
              />
            </div>
          )}
          {pip2Stream && (
            <div className="w-full aspect-video rounded-lg overflow-hidden border-2 border-primary/40 shadow-2xl">
              <video
                ref={pip2VideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover pointer-events-none"
                style={{ filter: buildFilterCss(activeFilter, colorGrade) || '' }}
              />
            </div>
          )}
        </DraggablePipStack>
      )}

      {/* Logo overlay — draggable pre-live */}
      {logo?.visible && (
        <DraggableLogo logo={logo} onMove={(x, y) => updateLogo({ x, y })} />
      )}

      {/* Lower Third overlay — cued (permanent) or the edited item (temp ghost).
          Pre-live shows either; live shows only the temp ghost since the cued
          one is already baked into the composite the branch above renders. */}
      {shownLt && (
        <LowerThirdOverlay
          data={shownLt}
          isTemp={shownLtIsTemp}
          dragging={ltDragging}
          dragRef={ltRef}
          onPointerDown={ltPointerDown}
        />
      )}

      {/* Active Poll overlay */}
      {activePoll && (
        <div className="absolute top-3 right-3 w-60 bg-card/95 backdrop-blur-md rounded-lg border border-border p-3 z-10 animate-fade-in shadow-xl">
          <p className="text-[11px] font-bold text-primary tracking-widest mb-2">POLL</p>
          <p className="text-sm font-semibold text-foreground mb-3">{activePoll.question}</p>
          <div className="space-y-2">
            {activePoll.options.map((opt, i) => {
              const pct = totalVotes > 0 ? (opt.votes / totalVotes) * 100 : 0;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-foreground">{opt.text}</span>
                    <span className="text-muted-foreground font-mono">{Math.round(pct)}%</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 font-mono">{totalVotes} votes</p>
        </div>
      )}

      {/* Highlighted Q&A overlay */}
      {highlightedQuestion && (
        <div className="absolute bottom-16 left-4 max-w-sm bg-card/95 backdrop-blur-md rounded-lg border border-primary/20 p-3 z-10 animate-slide-up shadow-xl">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-bold text-primary tracking-widest">Q&A</span>
            <span className="text-[11px] text-muted-foreground">
              {highlightedQuestion.author} · {highlightedQuestion.platform}
            </span>
          </div>
          <p className="text-sm text-foreground font-medium leading-snug">{highlightedQuestion.text}</p>
        </div>
      )}
      {/* Scene layout rail — Split / PiP / Solo (applies once guests are on stage) */}
      {guests.length > 0 && (
        <StageLayoutRail value={guestLayout} onChange={setGuestLayout} />
      )}
      <TeleprompterOverlay />
      </div>
    </div>
  );
}
