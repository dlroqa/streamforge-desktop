import { useStudio, CONTROL_ROOM_MAX, CONTROL_ROOM_SFX_MAX, type ControlRoomSource, type ControlRoomSound } from '@/contexts/StudioContext';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, EyeOff, X, Wand2, Settings2, Plus, Layers, Volume2, Square, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';

// 3×3 quick-position grid (fractions of the canvas)
const POSITIONS = [0.1, 0.5, 0.9];

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(255,255,255,${alpha / 100})`;
  const [r, g, b] = [m[1], m[2], m[3]].map(h => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha / 100})`;
}

/** One filled source button: graphic preview backdrop, centred custom-coloured
 * name, on-air badge, and a gear (lower-right) that opens its settings. The
 * on-air toggle and the gear are separate sibling controls (not nested), so
 * each receives its own clicks cleanly. */
function SourceButton({ source, onAir, onToggleAir, onOpenSettings, settingsOpen }: {
  source: ControlRoomSource;
  onAir: boolean;
  onToggleAir: () => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
}) {
  return (
    <div
      className={`group relative aspect-square w-full select-none overflow-hidden rounded-xl border-2 transition-all ${
        onAir
          ? 'border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.25)]'
          : 'border-border hover:border-primary/50'
      }`}
    >
      {/* Decorative layers — never intercept clicks. */}
      <div className="pointer-events-none absolute inset-0 bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:14px_14px]" />
      {source.kind === 'video' ? (
        <video
          src={source.url}
          autoPlay loop muted playsInline
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity ${onAir ? 'opacity-100' : 'opacity-40'}`}
        />
      ) : (
        <img
          src={source.url}
          alt=""
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity ${onAir ? 'opacity-100' : 'opacity-40'}`}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/30" />

      {/* On-air toggle — the whole square (below the gear). */}
      <button
        type="button"
        onClick={onToggleAir}
        aria-label={onAir ? 'Take off air' : 'Put on air'}
        title={onAir ? 'Click to take off air' : 'Click to put on air'}
        className="absolute inset-0 z-0 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />

      <span
        className={`pointer-events-none absolute left-1.5 top-1.5 z-[1] flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide transition-colors ${
          onAir ? 'bg-live text-white' : 'bg-black/50 text-white/70'
        }`}
      >
        <span className={`h-1 w-1 rounded-full ${onAir ? 'bg-white animate-pulse-live' : 'bg-white/60'}`} />
        {onAir ? 'On air' : 'Off'}
      </span>

      <span
        className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center px-2 text-center text-sm font-semibold leading-tight break-words"
        style={{ color: hexToRgba(source.color, source.alpha), textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
      >
        {source.name || 'Untitled'}
      </span>

      {/* Settings gear — on top of the toggle, in the lower-right corner. */}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Button settings"
        aria-pressed={settingsOpen}
        title="Button settings"
        className={`absolute bottom-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-white/20 backdrop-blur-sm transition-colors ${
          settingsOpen ? 'bg-primary text-primary-foreground' : 'bg-black/50 text-white hover:bg-black/70'
        }`}
      >
        <Settings2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/** An empty slot awaiting content. Clicking jumps to where new items are added
 * (the Motion Graphics Library for graphics, the Media Library for sounds). */
function SafeZoneButton({ onAdd, title = 'Add a graphic from the Motion Graphics Library' }: {
  onAdd: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      title={title}
      className="group relative flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-border/60 bg-secondary/10 text-muted-foreground/50 transition-colors hover:border-primary/40 hover:bg-secondary/20 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Plus className="h-4 w-4" />
    </button>
  );
}

/** One Sound Fx cue button: tap to fire the sound into the broadcast, tap again
 * to stop. A gear (lower-right) reveals rename/remove. */
function CueButton({ sound, playing, onFire, onOpenSettings, settingsOpen }: {
  sound: ControlRoomSound;
  playing: boolean;
  onFire: () => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
}) {
  return (
    <div
      className={`group relative aspect-square w-full select-none overflow-hidden rounded-xl border-2 transition-all ${
        playing
          ? 'border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.25)]'
          : 'border-border hover:border-primary/50'
      }`}
    >
      <button
        type="button"
        onClick={onFire}
        aria-label={playing ? `Stop ${sound.name}` : `Fire ${sound.name}`}
        title={playing ? 'Click to stop' : 'Click to fire this cue'}
        className="absolute inset-0 z-0 flex flex-col items-center justify-center gap-1.5 rounded-[10px] bg-secondary/40 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {playing
          ? <Square className="h-5 w-5 fill-current text-primary" />
          : <Volume2 className="h-6 w-6 text-muted-foreground group-hover:text-foreground" />}
        <span className="px-2 text-center text-xs font-semibold leading-tight break-words text-foreground">
          {sound.name || 'Sound'}
        </span>
      </button>

      {playing && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-[1] flex items-center gap-1 rounded bg-live px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white">
          <span className="h-1 w-1 rounded-full bg-white animate-pulse-live" /> Playing
        </span>
      )}

      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Cue settings"
        aria-pressed={settingsOpen}
        title="Cue settings"
        className={`absolute bottom-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-white/20 backdrop-blur-sm transition-colors ${
          settingsOpen ? 'bg-primary text-primary-foreground' : 'bg-black/50 text-white hover:bg-black/70'
        }`}
      >
        <Settings2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Sound Fx tab: a grid of one-tap cue buttons added from the Media Library. */
function SoundFxCues() {
  const {
    controlRoomSounds, playingControlRoomSoundId,
    playControlRoomSound, updateControlRoomSound, removeControlRoomSound,
    setActivePanel, setMediaLibrarySection,
  } = useStudio();

  const [openId, setOpenId] = useState<string | null>(null);
  const editing = controlRoomSounds.find(s => s.id === openId) ?? null;

  // Jump straight to the Media Library's Sound Fx browser, where cues are added.
  const openSoundFxLibrary = () => { setMediaLibrarySection('soundfx'); setActivePanel('stock'); };

  // Pad out only the current row, mirroring the Video Fx bank — never a wall of
  // 20 empty slots. Capped at CONTROL_ROOM_SFX_MAX.
  const filled = controlRoomSounds.length;
  const emptySlots = Math.min(
    filled % 2 === 0 ? 2 : 1,
    CONTROL_ROOM_SFX_MAX - filled,
  );

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Your sound cues — up to {CONTROL_ROOM_SFX_MAX}. Tap to fire into the
        broadcast, tap again to stop.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {controlRoomSounds.map(sound => {
          const playing = sound.id === playingControlRoomSoundId;
          const isEditing = openId === sound.id;
          return (
            <Fragment key={sound.id}>
              <CueButton
                sound={sound}
                playing={playing}
                onFire={() => playControlRoomSound(sound.id)}
                onOpenSettings={() => setOpenId(id => (id === sound.id ? null : sound.id))}
                settingsOpen={isEditing}
              />
              {isEditing && editing && (
                <div className="col-span-2 space-y-3 rounded-lg border border-primary/40 bg-secondary/20 p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-foreground truncate">{editing.name || 'Sound'} — settings</h3>
                    <button
                      onClick={() => setOpenId(null)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Close settings"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground block">Cue name</label>
                    <Input
                      value={editing.name}
                      onChange={e => updateControlRoomSound(editing.id, { name: e.target.value })}
                      placeholder="Name this cue"
                      maxLength={40}
                      className="h-8 text-xs"
                    />
                  </div>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => { removeControlRoomSound(editing.id); setOpenId(null); }}
                    className="w-full gap-2 text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove cue
                  </Button>
                </div>
              )}
            </Fragment>
          );
        })}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <SafeZoneButton
            key={`safe-${i}`}
            onAdd={openSoundFxLibrary}
            title="Add a sound effect from the Media Library"
          />
        ))}
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={openSoundFxLibrary}
        className="w-full gap-1.5 text-xs"
      >
        <Volume2 className="h-3.5 w-3.5" /> Add more
      </Button>

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        Cues mix into the live broadcast audio (and your monitor — use headphones
        to avoid echo). Your cues are saved on this device.
      </p>
    </div>
  );
}

/**
 * Control Room — two banks: "Video Fx" holds up to {@link CONTROL_ROOM_MAX}
 * square graphic "source" buttons (one live at a time over the video), and
 * "Sound Fx" holds one-tap sound cue buttons. Both are populated from the Media
 * Library / Motion Graphics and persist per device.
 */
export function ControlRoomPanel() {
  const {
    controlRoomSources, activeControlRoomId, isLive,
    putControlRoomSourceOnAir, takeControlRoomOffAir,
    updateControlRoomSource, removeControlRoomSource,
    setActivePanel, setGraphicsSection,
  } = useStudio();

  // Deep-link to the Motion Graphics Library (a section of Graphic Interface).
  const openLibrary = () => { setGraphicsSection('motion'); setActivePanel('graphics'); };

  const [openSettingsId, setOpenSettingsId] = useState<string | null>(null);
  const editing = controlRoomSources.find(s => s.id === openSettingsId) ?? null;

  // Only pad out the current row: complete a partial pair, or open the next
  // pair once a row is full — never a wall of 20 empty slots. Capped at 20.
  const filled = controlRoomSources.length;
  const emptySlots = Math.min(
    filled % 2 === 0 ? 2 : 1,
    CONTROL_ROOM_MAX - filled,
  );

  return (
    <Tabs defaultValue="video" className="w-full">
      <TabsList className="grid w-full grid-cols-2 h-8 mb-4">
        <TabsTrigger value="video" className="text-xs gap-1"><Layers className="h-3 w-3" />Video Fx</TabsTrigger>
        <TabsTrigger value="sound" className="text-xs gap-1"><Volume2 className="h-3 w-3" />Sound Fx</TabsTrigger>
      </TabsList>

      <TabsContent value="video" className="mt-0 space-y-4">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Your graphic sources — up to {CONTROL_ROOM_MAX}. Click a button to take it
        on/off air over the video.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {controlRoomSources.map(source => {
          const onAir = source.id === activeControlRoomId;
          const isEditing = openSettingsId === source.id;
          return (
            <Fragment key={source.id}>
              <SourceButton
                source={source}
                onAir={onAir}
                onToggleAir={() => (onAir ? takeControlRoomOffAir() : putControlRoomSourceOnAir(source.id))}
                onOpenSettings={() => setOpenSettingsId(id => (id === source.id ? null : source.id))}
                settingsOpen={isEditing}
              />
              {/* Settings drop down directly beneath the button's row, spanning
                  the full width — no scrolling past "Add more" to reach them. */}
              {isEditing && editing && (
                <div className="col-span-2 space-y-4 rounded-lg border border-primary/40 bg-secondary/20 p-3 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-foreground truncate">{editing.name || 'Untitled'} — settings</h3>
                    <button
                      onClick={() => setOpenSettingsId(null)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Close settings"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Name + colour */}
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground block">Button name</label>
                    <Input
                      value={editing.name}
                      onChange={e => updateControlRoomSource(editing.id, { name: e.target.value })}
                      placeholder="Name this button"
                      maxLength={32}
                      className="h-8 text-xs"
                    />
                    <div className="flex items-center gap-3 pt-1">
                      <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer shrink-0" title="Name colour">
                        <input
                          type="color"
                          value={editing.color}
                          onChange={e => updateControlRoomSource(editing.id, { color: e.target.value })}
                          className="h-6 w-8 rounded border border-border bg-transparent cursor-pointer"
                          aria-label="Name colour"
                        />
                        Colour
                      </label>
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground">Transparency</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{editing.alpha}%</span>
                        </div>
                        <Slider
                          value={[editing.alpha]} min={10} max={100} step={1}
                          onValueChange={([v]) => updateControlRoomSource(editing.id, { alpha: v })}
                          aria-label="Name opacity"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border/60" />

                  {/* On-air toggle */}
                  <Button
                    size="sm"
                    variant={onAir ? 'destructive' : 'default'}
                    onClick={() => (onAir ? takeControlRoomOffAir() : putControlRoomSourceOnAir(editing.id))}
                    className="w-full gap-1.5 text-xs"
                  >
                    {onAir ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {onAir ? 'Take off air' : 'Put on air'}
                  </Button>

                  {/* Quick positions */}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Position</label>
                    <div className="grid grid-cols-3 gap-1 w-24 mx-auto">
                      {POSITIONS.map(py =>
                        POSITIONS.map(px => {
                          const active = Math.abs(editing.x - px) < 0.05 && Math.abs(editing.y - py) < 0.05;
                          return (
                            <button
                              key={`${px}-${py}`}
                              onClick={() => updateControlRoomSource(editing.id, { x: px, y: py })}
                              className={`h-7 rounded border transition-colors ${
                                active ? 'bg-primary border-primary' : 'bg-secondary/50 border-border hover:bg-secondary'
                              }`}
                              title={`Move to ${py < 0.3 ? 'top' : py > 0.7 ? 'bottom' : 'middle'} ${px < 0.3 ? 'left' : px > 0.7 ? 'right' : 'center'}`}
                            />
                          );
                        }),
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground text-center mt-1.5">
                      {isLive ? 'Fine-tune with the sliders below' : 'Or drag the graphic directly on the preview'}
                    </p>
                  </div>

                  {/* Fine positioning */}
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">Horizontal</span>
                        <span className="text-[11px] font-mono text-muted-foreground">{Math.round(editing.x * 100)}%</span>
                      </div>
                      <Slider value={[editing.x * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateControlRoomSource(editing.id, { x: v / 100 })} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">Vertical</span>
                        <span className="text-[11px] font-mono text-muted-foreground">{Math.round(editing.y * 100)}%</span>
                      </div>
                      <Slider value={[editing.y * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateControlRoomSource(editing.id, { y: v / 100 })} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">Size</span>
                        <span className="text-[11px] font-mono text-muted-foreground">{Math.round(editing.scale * 100)}%</span>
                      </div>
                      <Slider value={[editing.scale * 100]} min={3} max={60} step={1} onValueChange={([v]) => updateControlRoomSource(editing.id, { scale: v / 100 })} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">Opacity</span>
                        <span className="text-[11px] font-mono text-muted-foreground">{editing.opacity}%</span>
                      </div>
                      <Slider value={[editing.opacity]} min={10} max={100} step={1} onValueChange={([v]) => updateControlRoomSource(editing.id, { opacity: v })} />
                    </div>
                  </div>

                  <Button
                    size="sm" variant="outline"
                    onClick={() => { removeControlRoomSource(editing.id); setOpenSettingsId(null); }}
                    className="w-full gap-2 text-xs text-destructive hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" /> Remove from Control Room
                  </Button>
                </div>
              )}
            </Fragment>
          );
        })}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <SafeZoneButton key={`safe-${i}`} onAdd={openLibrary} />
        ))}
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={openLibrary}
        className="w-full gap-1.5 text-xs"
      >
        <Wand2 className="h-3.5 w-3.5" /> Add more
      </Button>

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        The on-air source composites above the video, below lower thirds and
        polls. One source is live at a time. Your bank is saved on this device
        and restored the next time you open the studio.
      </p>
      </TabsContent>

      <TabsContent value="sound" className="mt-0">
        <SoundFxCues />
      </TabsContent>
    </Tabs>
  );
}
