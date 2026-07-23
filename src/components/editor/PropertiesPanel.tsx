import { Fragment, useEffect, useRef, useState } from 'react';
import {
  type EditorProject, type EditorClip, type EditorOverlay, type EditorAudioClip,
  clipLength, audioClipLength, formatTimecode, updateClipById, updateOverlayById, updateAudioClipById, reflowClips,
  resetFraming, isDefaultFraming, BLEND_MODES, type BlendModeId,
  moveClipToTrack, clipTrack, BASE_TRACK, UPPER_TRACK,
} from '@/lib/editorProject';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { Trash2, Volume2, VolumeX, Music, Crop, Maximize2, Sparkles, Diamond, Plus, Clapperboard, Blend, RotateCw, Move, Video, Loader2, Layers } from 'lucide-react';
import { LOWER_THIRD_FONTS, DEFAULT_LOWER_THIRD_BLOCK_STYLE, type LowerThirdBlockStyle } from '@/lib/lowerThird';
import {
  MOTION_PRESET_OPTIONS, EASING_OPTIONS,
  sampleKeyframeProps, findKeyframeIndexAt, upsertKeyframe, removeKeyframe, setKeyframeEasing,
  type MotionPreset, type MotionPresetId, type EasingId, type AnimatableProps,
} from '@/lib/overlayAnimation';

/** Icon categories for the selected clip's inspectors. The Color Inspector
 *  joins this list next. */
const CLIP_INSPECTORS = [
  { id: 'video', icon: Clapperboard, label: 'Video Inspector' },
  { id: 'audio', icon: Music, label: 'Audio Inspector' },
] as const;
type ClipInspector = typeof CLIP_INSPECTORS[number]['id'];

/** One in/out motion row: preset + duration + easing. */
function MotionControls({ label, motion, defaultEasing, onPreset, onDuration, onDurationCommit, onEasing }: {
  label: string;
  motion: MotionPreset | undefined;
  defaultEasing: EasingId;
  onPreset: (id: MotionPresetId) => void;
  onDuration: (v: number) => void;
  onDurationCommit: () => void;
  onEasing: (id: EasingId) => void;
}) {
  const preset = motion?.preset ?? 'none';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground w-7 shrink-0">{label}</span>
        <Select value={preset} onValueChange={v => onPreset(v as MotionPresetId)}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MOTION_PRESET_OPTIONS.map(o => <SelectItem key={o.id} value={o.id} className="text-xs">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {preset !== 'none' && (
        <div className="flex items-center gap-1.5 pl-[34px]">
          <Slider
            className="flex-1"
            value={[motion?.duration ?? 0.5]} min={0.1} max={2} step={0.1}
            onValueChange={([v]) => onDuration(v)} onValueCommit={onDurationCommit}
          />
          <span className="text-[10px] font-mono text-muted-foreground w-8 text-right shrink-0">{(motion?.duration ?? 0.5).toFixed(1)}s</span>
          <Select value={motion?.easing ?? defaultEasing} onValueChange={v => onEasing(v as EasingId)}>
            <SelectTrigger className="h-7 text-xs w-[86px] shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EASING_OPTIONS.map(o => <SelectItem key={o.id} value={o.id} className="text-xs">{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function FadeControls({ fadeIn, fadeOut, max, onIn, onOut, onCommit }: {
  fadeIn: number; fadeOut: number; max: number;
  onIn: (v: number) => void; onOut: (v: number) => void; onCommit: () => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">Fade in</span>
          <span className="text-[11px] font-mono text-muted-foreground">{fadeIn.toFixed(1)}s</span>
        </div>
        <Slider value={[fadeIn]} min={0} max={max} step={0.1} onValueChange={([v]) => onIn(v)} onValueCommit={onCommit} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">Fade out</span>
          <span className="text-[11px] font-mono text-muted-foreground">{fadeOut.toFixed(1)}s</span>
        </div>
        <Slider value={[fadeOut]} min={0} max={max} step={0.1} onValueChange={([v]) => onOut(v)} onValueCommit={onCommit} />
      </div>
    </div>
  );
}

/** Right panel: edits the selected clip's audio or the selected overlay. Uses
 * transient updates during drags/typing and commits one undo step per edit. */
export function PropertiesPanel({
  project, playhead, clip, overlay, audio, setProjectTransient, commitHistory, onRemoveClip, onRemoveOverlay, onRemoveAudio,
  onStabilize, stabilizingClipId, stabilizePct,
}: {
  project: EditorProject;
  playhead: number;
  clip: EditorClip | null;
  overlay: EditorOverlay | null;
  audio: EditorAudioClip | null;
  setProjectTransient: (producer: (p: EditorProject) => EditorProject) => void;
  commitHistory: (before: EditorProject) => void;
  onRemoveClip: (id: string) => void;
  onRemoveOverlay: (id: string) => void;
  onRemoveAudio: (id: string) => void;
  /** Toggle/apply FFmpeg deshake stabilization for a clip. */
  onStabilize: (clipId: string, enabled: boolean, strength: number) => void;
  /** Clip id currently being stabilized (null when idle). */
  stabilizingClipId: string | null;
  /** 0–1 progress of the in-flight stabilization bake. */
  stabilizePct: number;
}) {
  const [inspector, setInspector] = useState<ClipInspector>('video');
  // Pending stabilization strength for the slider — seeded from the clip and
  // only baked when the user flips the toggle or hits re-stabilize.
  const [pendingStrength, setPendingStrength] = useState(0.5);
  useEffect(() => { setPendingStrength(clip?.stabilizeStrength ?? 0.5); }, [clip?.id, clip?.stabilizeStrength]);
  // Capture a pre-edit snapshot on the first change of a gesture, commit at end.
  const beforeRef = useRef<EditorProject | null>(null);
  const begin = () => { if (!beforeRef.current) beforeRef.current = project; };
  const commit = () => { if (beforeRef.current) { commitHistory(beforeRef.current); beforeRef.current = null; } };
  // One-shot discrete change (toggles, etc.)
  const discrete = (producer: (p: EditorProject) => EditorProject) => {
    commitHistory(project);
    setProjectTransient(producer);
  };

  const setClip = (patch: Partial<EditorClip>) => setProjectTransient(p => updateClipById(p, clip!.id, patch));
  const setOverlay = (patch: Partial<EditorOverlay>) => setProjectTransient(p => updateOverlayById(p, overlay!.id, patch));
  const setAudio = (patch: Partial<EditorAudioClip>) => setProjectTransient(p => updateAudioClipById(p, audio!.id, patch));

  // Lower-third style/motion helpers (used only when a lower third is selected)
  const lt: LowerThirdBlockStyle = overlay?.ltStyle ?? DEFAULT_LOWER_THIRD_BLOCK_STYLE;
  const setLt = (patch: Partial<LowerThirdBlockStyle>) => setOverlay({ ltStyle: { ...lt, ...patch } });
  const discreteLt = (patch: Partial<LowerThirdBlockStyle>) =>
    discrete(p => updateOverlayById(p, overlay!.id, { ltStyle: { ...lt, ...patch } }));
  const setMotionPreset = (phase: 'in' | 'out', id: MotionPresetId) => {
    const anim = overlay!.animation ?? {};
    const cur = anim[phase];
    const next: MotionPreset | undefined = id === 'none' ? undefined : {
      preset: id,
      duration: cur?.duration ?? 0.5,
      easing: cur?.easing ?? (phase === 'in' ? 'easeOutCubic' : 'easeInOutCubic'),
    };
    discrete(p => updateOverlayById(p, overlay!.id, { animation: { ...anim, [phase]: next } }));
  };
  const setMotionDuration = (phase: 'in' | 'out', v: number) => {
    const anim = overlay!.animation ?? {};
    const cur = anim[phase];
    if (!cur) return;
    begin();
    setOverlay({ animation: { ...anim, [phase]: { ...cur, duration: v } } });
  };
  const setMotionEasing = (phase: 'in' | 'out', id: EasingId) => {
    const anim = overlay!.animation ?? {};
    const cur = anim[phase];
    if (!cur) return;
    discrete(p => updateOverlayById(p, overlay!.id, { animation: { ...anim, [phase]: { ...cur, easing: id } } }));
  };

  // Keyframe state at the playhead (keyframe times are overlay-relative)
  const kfLocalT = overlay ? playhead - overlay.start : 0;
  const kfInWindow = !!overlay && playhead >= overlay.start && playhead < overlay.end;
  const kfList = overlay?.animation?.keyframes;
  const kfAtPlayhead = kfInWindow ? findKeyframeIndexAt(kfList, kfLocalT) : -1;
  const kfBase = (): AnimatableProps => ({
    x: overlay!.x, y: overlay!.y,
    scale: overlay!.scale ?? 1, opacity: overlay!.opacity ?? 1, rotation: 0,
  });
  const addOrUpdateKeyframe = () => {
    // Capture what's on screen right now (keyframe stage only — presets are
    // envelopes on top and shouldn't be baked in).
    const sampled = kfList?.length ? sampleKeyframeProps(kfBase(), kfList, kfLocalT) : kfBase();
    const { x, y, scale, opacity } = sampled;
    discrete(p => updateOverlayById(p, overlay!.id, {
      animation: upsertKeyframe(overlay!.animation, kfLocalT, { x, y, scale, opacity }),
    }));
  };
  const deleteKeyframeAtPlayhead = () => {
    if (kfAtPlayhead < 0) return;
    discrete(p => updateOverlayById(p, overlay!.id, {
      animation: removeKeyframe(overlay!.animation, kfAtPlayhead),
    }));
  };
  const setKfEasing = (id: EasingId) => {
    if (kfAtPlayhead < 0) return;
    discrete(p => updateOverlayById(p, overlay!.id, {
      animation: setKeyframeEasing(overlay!.animation, kfAtPlayhead, id),
    }));
  };

  return (
    <div className="w-64 border-l border-border bg-card/40 flex flex-col shrink-0">
      <div className="px-3 py-2.5 border-b border-border">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Properties</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {!clip && !overlay && !audio && (
          <p className="text-xs text-muted-foreground/70">Select a clip, overlay, or audio to edit it.</p>
        )}

        {/* ── Selected clip: icon-category inspectors (Video · Audio — Color next) ── */}
        {clip && (
          <>
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Clip</p>
              <p className="text-sm text-foreground truncate">{clip.name}</p>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{formatTimecode(clipLength(clip))} of {formatTimecode(clip.sourceDuration)}</p>
            </div>

            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-secondary/40">
              {CLIP_INSPECTORS.map(({ id, icon: Icon, label }) => (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setInspector(id)}
                      aria-label={label}
                      className={`h-8 rounded-md flex items-center justify-center transition-colors ${
                        inspector === id
                          ? 'bg-primary/15 text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
                </Tooltip>
              ))}
            </div>

            {inspector === 'video' && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Speed</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{(clip.speed || 1).toFixed(2)}×</span>
                  </div>
                  <Slider
                    value={[clip.speed || 1]} min={0.25} max={4} step={0.05}
                    onValueChange={([v]) => { begin(); setProjectTransient(p => reflowClips(updateClipById(p, clip.id, { speed: v }))); }}
                    onValueCommit={commit}
                  />
                </div>

                {/* ── Layer ── */}
                <div className="pt-1 border-t border-border/60 space-y-2">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" /> Layer
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([[BASE_TRACK, 'Base'], [UPPER_TRACK, 'Layer 2']] as const).map(([track, label]) => (
                      <button
                        key={track}
                        onClick={() => { if (clipTrack(clip) !== track) discrete(p => moveClipToTrack(p, clip.id, track)); }}
                        className={`h-7 rounded-md text-xs border transition-colors ${
                          clipTrack(clip) === track
                            ? 'border-primary bg-primary/15 text-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Compositing ── */}
                <div className="pt-1 border-t border-border/60 space-y-2.5">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Blend className="h-3.5 w-3.5" /> Compositing
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">Blend mode</span>
                    <Select
                      value={clip.blendMode ?? 'normal'}
                      onValueChange={v => discrete(p => updateClipById(p, clip.id, { blendMode: v as BlendModeId }))}
                    >
                      <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {BLEND_MODES.map((m, i) => (
                          <Fragment key={m.id}>
                            {i > 0 && m.group !== BLEND_MODES[i - 1].group && <SelectSeparator />}
                            <SelectItem value={m.id} className="text-xs">{m.label}</SelectItem>
                          </Fragment>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {clipTrack(clip) === BASE_TRACK && (clip.blendMode ?? 'normal') !== 'normal' && (
                    <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                      Blend modes composite over the layer beneath. On the base track there's nothing below, so move this clip to <span className="text-foreground">Layer 2</span> to blend it over the footage.
                    </p>
                  )}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">Opacity</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{Math.round((clip.opacity ?? 1) * 100)}%</span>
                    </div>
                    <Slider
                      value={[(clip.opacity ?? 1) * 100]} min={0} max={100} step={1}
                      onValueChange={([v]) => { begin(); setClip({ opacity: v / 100 }); }}
                      onValueCommit={commit}
                    />
                  </div>
                </div>

                {/* ── Transform (fit / zoom / position / rotation) ── */}
                <div className="pt-1 border-t border-border/60 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Move className="h-3.5 w-3.5" /> Transform
                    </span>
                    {!isDefaultFraming(clip) && (
                      <button
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => discrete(p => resetFraming(p, clip.id))}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['contain', 'cover'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => discrete(p => updateClipById(p, clip.id, { fit: mode }))}
                        className={`h-7 rounded-md text-xs border transition-colors ${
                          (clip.fit ?? 'contain') === mode
                            ? 'border-primary bg-primary/15 text-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground hover:border-border'
                        }`}
                      >
                        {mode === 'contain' ? 'Fit' : 'Fill'}
                      </button>
                    ))}
                  </div>
                  {project.width !== project.height && (project.width < project.height) && (clip.fit ?? 'contain') === 'contain' && (
                    <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                      Use <span className="text-foreground">Fill</span> to crop this clip into the vertical frame, then drag the preview to reframe.
                    </p>
                  )}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Maximize2 className="h-3.5 w-3.5" /> Zoom
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground">{(clip.zoom ?? 1).toFixed(2)}×</span>
                    </div>
                    <Slider
                      value={[clip.zoom ?? 1]} min={1} max={4} step={0.05}
                      onValueChange={([v]) => { begin(); setClip({ zoom: v }); }}
                      onValueCommit={commit}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">Position X</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{Math.round((clip.panX ?? 0.5) * 100)}%</span>
                    </div>
                    <Slider
                      value={[(clip.panX ?? 0.5) * 100]} min={0} max={100} step={1}
                      onValueChange={([v]) => { begin(); setClip({ panX: v / 100 }); }}
                      onValueCommit={commit}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">Position Y</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{Math.round((clip.panY ?? 0.5) * 100)}%</span>
                    </div>
                    <Slider
                      value={[(clip.panY ?? 0.5) * 100]} min={0} max={100} step={1}
                      onValueChange={([v]) => { begin(); setClip({ panY: v / 100 }); }}
                      onValueCommit={commit}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <RotateCw className="h-3.5 w-3.5" /> Rotation
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground">{Math.round(clip.rotation ?? 0)}°</span>
                    </div>
                    <Slider
                      value={[clip.rotation ?? 0]} min={-180} max={180} step={1}
                      onValueChange={([v]) => { begin(); setClip({ rotation: v }); }}
                      onValueCommit={commit}
                    />
                  </div>
                </div>

                {/* ── Crop ── */}
                <div className="pt-1 border-t border-border/60 space-y-2.5">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Crop className="h-3.5 w-3.5" /> Crop
                  </span>
                  {([['Left', 'cropL'], ['Right', 'cropR'], ['Top', 'cropT'], ['Bottom', 'cropB']] as const).map(([label, key]) => (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <span className="text-[11px] font-mono text-muted-foreground">{Math.round((clip[key] ?? 0) * 100)}%</span>
                      </div>
                      <Slider
                        value={[(clip[key] ?? 0) * 100]} min={0} max={45} step={1}
                        onValueChange={([v]) => { begin(); setClip({ [key]: v / 100 }); }}
                        onValueCommit={commit}
                      />
                    </div>
                  ))}
                </div>

                {/* ── Stabilization (FFmpeg deshake, in-browser) ── */}
                {(() => {
                  const isStabilizing = stabilizingClipId === clip.id;
                  const strengthChanged = !!clip.stabilize && (clip.stabilizeStrength ?? 0.5) !== pendingStrength;
                  return (
                    <div className="pt-1 border-t border-border/60 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <Video className="h-3.5 w-3.5" /> Stabilization
                        </span>
                        <Switch
                          checked={!!clip.stabilize || isStabilizing}
                          disabled={!!stabilizingClipId}
                          onCheckedChange={v => onStabilize(clip.id, v, pendingStrength)}
                        />
                      </div>

                      {isStabilizing ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…
                            </span>
                            <span className="text-[11px] font-mono text-muted-foreground">{Math.round(stabilizePct * 100)}%</span>
                          </div>
                          <Progress value={stabilizePct * 100} className="h-1.5" />
                          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                            Running deshake in your browser — longer clips take a while. You can keep editing other clips.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs text-muted-foreground">Strength</span>
                              <span className="text-[11px] font-mono text-muted-foreground">{Math.round(pendingStrength * 100)}%</span>
                            </div>
                            <Slider
                              value={[pendingStrength * 100]} min={0} max={100} step={5}
                              disabled={!!stabilizingClipId}
                              onValueChange={([v]) => setPendingStrength(v / 100)}
                            />
                          </div>
                          {strengthChanged && (
                            <Button
                              size="sm" variant="outline" className="w-full gap-2"
                              disabled={!!stabilizingClipId}
                              onClick={() => onStabilize(clip.id, true, pendingStrength)}
                            >
                              <Video className="h-3.5 w-3.5" /> Re-stabilize at {Math.round(pendingStrength * 100)}%
                            </Button>
                          )}
                          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                            {clip.stabilize
                              ? 'Playing the stabilized copy. Toggle off to use the original.'
                              : 'Smooths handheld shake. Turning it on processes the clip once in your browser.'}
                          </p>
                        </>
                      )}
                    </div>
                  );
                })()}
              </>
            )}

            {inspector === 'audio' && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      {clip.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />} Volume
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">{Math.round(clip.volume * 100)}%</span>
                  </div>
                  <Slider
                    value={[clip.volume * 100]} min={0} max={100} step={1}
                    disabled={clip.muted}
                    onValueChange={([v]) => { begin(); setClip({ volume: v / 100 }); }}
                    onValueCommit={commit}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Mute clip</span>
                  <Switch checked={clip.muted} onCheckedChange={v => discrete(p => updateClipById(p, clip.id, { muted: v }))} />
                </div>
                <FadeControls
                  fadeIn={clip.fadeIn} fadeOut={clip.fadeOut} max={Math.max(0.5, clipLength(clip))}
                  onIn={v => { begin(); setClip({ fadeIn: v }); }} onOut={v => { begin(); setClip({ fadeOut: v }); }} onCommit={commit}
                />
              </>
            )}

            <Button size="sm" variant="outline" className="w-full gap-2 text-destructive hover:text-destructive" onClick={() => onRemoveClip(clip.id)}>
              <Trash2 className="h-3.5 w-3.5" /> Remove clip
            </Button>
          </>
        )}

        {/* ── Audio (music / voiceover) clip ── */}
        {audio && (
          <>
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5"><Music className="h-3.5 w-3.5" /> Audio</p>
              <p className="text-sm text-foreground truncate">{audio.name}</p>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{formatTimecode(audioClipLength(audio))} of {formatTimecode(audio.sourceDuration)}</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  {audio.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />} Volume
                </span>
                <span className="text-[11px] font-mono text-muted-foreground">{Math.round(audio.volume * 100)}%</span>
              </div>
              <Slider value={[audio.volume * 100]} min={0} max={100} step={1} disabled={audio.muted}
                onValueChange={([v]) => { begin(); setAudio({ volume: v / 100 }); }} onValueCommit={commit} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Mute</span>
              <Switch checked={audio.muted} onCheckedChange={v => discrete(p => updateAudioClipById(p, audio.id, { muted: v }))} />
            </div>
            <FadeControls
              fadeIn={audio.fadeIn} fadeOut={audio.fadeOut} max={Math.max(0.5, audioClipLength(audio))}
              onIn={v => { begin(); setAudio({ fadeIn: v }); }} onOut={v => { begin(); setAudio({ fadeOut: v }); }} onCommit={commit}
            />
            <Button size="sm" variant="outline" className="w-full gap-2 text-destructive hover:text-destructive" onClick={() => onRemoveAudio(audio.id)}>
              <Trash2 className="h-3.5 w-3.5" /> Remove audio
            </Button>
          </>
        )}

        {/* ── Overlay ── */}
        {overlay && (
          <>
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
                {overlay.type === 'text' ? 'Text overlay' : overlay.type === 'lowerThird' ? 'Lower third' : 'Image overlay'}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono">{formatTimecode(overlay.start)} – {formatTimecode(overlay.end)}</p>
            </div>

            {overlay.type === 'text' && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Text</label>
                  <Input
                    value={overlay.text ?? ''}
                    onChange={e => { begin(); setOverlay({ text: e.target.value }); }}
                    onBlur={commit}
                    className="text-sm"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Font size</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{overlay.fontSize}px</span>
                  </div>
                  <Slider
                    value={[overlay.fontSize ?? 64]} min={16} max={220} step={1}
                    onValueChange={([v]) => { begin(); setOverlay({ fontSize: v }); }}
                    onValueCommit={commit}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Text color</span>
                  <input type="color" value={overlay.color ?? '#ffffff'}
                    onInput={e => { begin(); setOverlay({ color: (e.target as HTMLInputElement).value }); }}
                    onChange={commit}
                    className="h-6 w-10 rounded border border-border bg-transparent cursor-pointer" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Background</span>
                  <Switch checked={!!overlay.bgColor}
                    onCheckedChange={v => discrete(p => updateOverlayById(p, overlay.id, { bgColor: v ? '#000000' : null }))} />
                </div>
                {overlay.bgColor && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Background color</span>
                    <input type="color" value={overlay.bgColor}
                      onInput={e => { begin(); setOverlay({ bgColor: (e.target as HTMLInputElement).value }); }}
                      onChange={commit}
                      className="h-6 w-10 rounded border border-border bg-transparent cursor-pointer" />
                  </div>
                )}
              </>
            )}

            {overlay.type === 'lowerThird' && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Title</label>
                  <Input
                    value={overlay.title ?? ''}
                    onChange={e => { begin(); setOverlay({ title: e.target.value }); }}
                    onBlur={commit}
                    className="text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Subtitle</label>
                  <Input
                    value={overlay.subtitle ?? ''}
                    onChange={e => { begin(); setOverlay({ subtitle: e.target.value }); }}
                    onBlur={commit}
                    className="text-sm"
                  />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {([['none', 'Text'], ['rounded', 'Rounded'], ['pill', 'Pill']] as const).map(([shape, label]) => (
                    <button
                      key={shape}
                      onClick={() => discreteLt({ shape })}
                      className={`h-7 rounded-md text-xs border transition-colors ${
                        lt.shape === shape
                          ? 'border-primary bg-primary/15 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Font</label>
                  <Select value={lt.font} onValueChange={v => discreteLt({ font: v as LowerThirdBlockStyle['font'] })}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LOWER_THIRD_FONTS.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Text color</span>
                  <input type="color" value={lt.textColor}
                    onInput={e => { begin(); setLt({ textColor: (e.target as HTMLInputElement).value }); }}
                    onChange={commit}
                    className="h-6 w-10 rounded border border-border bg-transparent cursor-pointer" />
                </div>
                {lt.shape !== 'none' && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Background color</span>
                      <input type="color" value={lt.bgColor}
                        onInput={e => { begin(); setLt({ bgColor: (e.target as HTMLInputElement).value }); }}
                        onChange={commit}
                        className="h-6 w-10 rounded border border-border bg-transparent cursor-pointer" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Accent color</span>
                      <input type="color" value={lt.accentColor}
                        onInput={e => { begin(); setLt({ accentColor: (e.target as HTMLInputElement).value }); }}
                        onChange={commit}
                        className="h-6 w-10 rounded border border-border bg-transparent cursor-pointer" />
                    </div>
                  </>
                )}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Title size</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{lt.titleSize}</span>
                  </div>
                  <Slider value={[lt.titleSize]} min={14} max={64} step={1}
                    onValueChange={([v]) => { begin(); setLt({ titleSize: v }); }} onValueCommit={commit} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Subtitle size</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{lt.subtitleSize}</span>
                  </div>
                  <Slider value={[lt.subtitleSize]} min={10} max={44} step={1}
                    onValueChange={([v]) => { begin(); setLt({ subtitleSize: v }); }} onValueCommit={commit} />
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="grid grid-cols-3 gap-1 flex-1">
                    {(['left', 'center', 'right'] as const).map(a => (
                      <button key={a} onClick={() => discreteLt({ align: a })}
                        className={`h-7 rounded-md text-xs border transition-colors capitalize ${
                          lt.align === a ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                        }`}>
                        {a === 'left' ? 'L' : a === 'center' ? 'C' : 'R'}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1 flex-1">
                    {([['bold', 'B'], ['italic', 'I'], ['underline', 'U']] as const).map(([k, label]) => (
                      <button key={k} onClick={() => discreteLt({ [k]: !lt[k] } as Partial<LowerThirdBlockStyle>)}
                        className={`h-7 rounded-md text-xs border transition-colors ${
                          k === 'bold' ? 'font-bold' : k === 'italic' ? 'italic' : 'underline'
                        } ${lt[k] ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Motion ── */}
                <div className="pt-1 border-t border-border/60 space-y-2">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> Motion
                  </span>
                  <MotionControls
                    label="In" motion={overlay.animation?.in} defaultEasing="easeOutCubic"
                    onPreset={id => setMotionPreset('in', id)}
                    onDuration={v => setMotionDuration('in', v)}
                    onDurationCommit={commit}
                    onEasing={id => setMotionEasing('in', id)}
                  />
                  <MotionControls
                    label="Out" motion={overlay.animation?.out} defaultEasing="easeInOutCubic"
                    onPreset={id => setMotionPreset('out', id)}
                    onDuration={v => setMotionDuration('out', v)}
                    onDurationCommit={commit}
                    onEasing={id => setMotionEasing('out', id)}
                  />
                </div>

                {/* ── Keyframes ── */}
                <div className="pt-1 border-t border-border/60 space-y-2">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Diamond className="h-3 w-3" /> Keyframes
                    {(kfList?.length ?? 0) > 0 && (
                      <span className="text-[10px] font-mono normal-case tracking-normal">({kfList!.length})</span>
                    )}
                  </span>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">Opacity</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{Math.round((overlay.opacity ?? 1) * 100)}%</span>
                    </div>
                    <Slider value={[(overlay.opacity ?? 1) * 100]} min={0} max={100} step={1}
                      onValueChange={([v]) => { begin(); setOverlay({ opacity: v / 100 }); }} onValueCommit={commit} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">Scale</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{Math.round((overlay.scale ?? 1) * 100)}%</span>
                    </div>
                    <Slider value={[(overlay.scale ?? 1) * 100]} min={25} max={300} step={5}
                      onValueChange={([v]) => { begin(); setOverlay({ scale: v / 100 }); }} onValueCommit={commit} />
                  </div>
                  {kfInWindow ? (
                    <>
                      <Button size="sm" variant="outline" className="w-full gap-2" onClick={addOrUpdateKeyframe}>
                        {kfAtPlayhead >= 0
                          ? <><Diamond className="h-3 w-3 fill-current" /> Update keyframe</>
                          : <><Plus className="h-3.5 w-3.5" /> Add keyframe at playhead</>}
                      </Button>
                      {kfAtPlayhead >= 0 && (
                        <div className="flex items-center gap-1.5">
                          <Select value={kfList![kfAtPlayhead].easing ?? 'linear'} onValueChange={v => setKfEasing(v as EasingId)}>
                            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {EASING_OPTIONS.map(o => <SelectItem key={o.id} value={o.id} className="text-xs">{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-destructive hover:text-destructive" onClick={deleteKeyframeAtPlayhead} title="Delete this keyframe">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                        Scrub, then reposition or change opacity/scale and add a keyframe — the motion interpolates between diamonds on the timeline.
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                      Move the playhead inside this overlay to edit keyframes.
                    </p>
                  )}
                </div>
              </>
            )}

            {overlay.type === 'image' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">Size</span>
                  <span className="text-[11px] font-mono text-muted-foreground">{Math.round((overlay.width ?? 0.3) * 100)}%</span>
                </div>
                <Slider
                  value={[(overlay.width ?? 0.3) * 100]} min={5} max={100} step={1}
                  onValueChange={([v]) => { begin(); setOverlay({ width: v / 100 }); }}
                  onValueCommit={commit}
                />
              </div>
            )}

            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">Drag it on the preview to reposition.</p>
            <Button size="sm" variant="outline" className="w-full gap-2 text-destructive hover:text-destructive" onClick={() => onRemoveOverlay(overlay.id)}>
              <Trash2 className="h-3.5 w-3.5" /> Remove overlay
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
