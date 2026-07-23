import { useStudio, type Scene, type TransitionType } from '@/contexts/StudioContext';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Plus, Camera, MonitorUp, Presentation, Film, User, Volume2, VolumeX, Radio, ImageOff,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

const TRANSITIONS: { value: TransitionType; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'crossfade', label: 'Cross-Fade' },
  { value: 'slide', label: 'Slide' },
];

const KIND_ICON = {
  camera1: Camera,
  camera2: Camera,
  screen: MonitorUp,
  slides: Presentation,
  media: Film,
  guest: User,
} as const;

/** Live-feed thumbnail for a scene (muted — audio is monitored elsewhere). */
function SceneThumb({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  if (!stream) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-secondary/40 text-muted-foreground">
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  return <video ref={ref} autoPlay muted playsInline className="w-full h-full object-cover" />;
}

/** Compact volume control shown under audio-bearing scenes (guests, media). */
function SceneVolume({ scene }: { scene: Scene }) {
  const { guestVolumes, setGuestVolume, mediaMonitor, toggleMediaMonitor } = useStudio();

  if (scene.kind === 'guest' && scene.guestId) {
    const vol = guestVolumes[scene.guestId] ?? 100;
    const muted = vol === 0;
    return (
      <div className="flex items-center gap-2 px-2 pb-2 pt-1">
        <button
          onClick={() => setGuestVolume(scene.guestId!, muted ? 100 : 0)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title={muted ? 'Unmute guest (monitor)' : 'Mute guest (monitor)'}
          aria-label={muted ? 'Unmute guest' : 'Mute guest'}
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
        <Slider
          value={[vol]}
          min={0}
          max={100}
          step={1}
          onValueChange={([v]) => setGuestVolume(scene.guestId!, v)}
          className="flex-1"
          aria-label="Guest monitor volume"
        />
      </div>
    );
  }

  if (scene.kind === 'media') {
    return (
      <div className="flex items-center gap-2 px-2 pb-2 pt-1">
        <button
          onClick={toggleMediaMonitor}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title={mediaMonitor ? 'Mute media monitor' : 'Unmute media monitor'}
          aria-label={mediaMonitor ? 'Mute media' : 'Unmute media'}
        >
          {mediaMonitor ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {mediaMonitor ? 'Monitoring audio' : 'Audio muted (local)'}
        </span>
      </div>
    );
  }
  return null;
}

function SceneTile({ scene }: { scene: Scene }) {
  const { activeSceneId, takeScene } = useStudio();
  const onAir = scene.id === activeSceneId;
  const Icon = KIND_ICON[scene.kind];

  return (
    <div
      className={`rounded-xl overflow-hidden border transition-colors ${
        onAir ? 'border-live ring-2 ring-live/60' : 'border-border hover:border-primary/50'
      }`}
    >
      <button
        onClick={() => takeScene(scene.id)}
        className="block w-full text-left group"
        title={`Cut to ${scene.label}`}
      >
        <div className="relative aspect-video bg-background">
          <SceneThumb stream={scene.stream} />
          {onAir && (
            <span className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-live text-live-foreground text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded">
              <span className="h-1.5 w-1.5 rounded-full bg-live-foreground animate-pulse-live" />
              ON SCREEN
            </span>
          )}
          {!onAir && (
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-background/40">
              <span className="flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-bold tracking-wider px-2 py-1 rounded-md shadow">
                <Radio className="h-3 w-3" /> TAKE
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">{scene.label}</span>
        </div>
      </button>
      {scene.hasAudio && <SceneVolume scene={scene} />}
    </div>
  );
}

/**
 * Scenes switcher: a live video switcher docked on the left. Each active
 * source (cameras, screen share / slides, cued media, and every guest) shows
 * as a tile with a live thumbnail; clicking cuts the program bus to it with the
 * chosen transition. Video and guest tiles carry a volume control.
 */
export function ScenesPanel() {
  const { scenes, transitionType, setTransitionType, setActivePanel } = useStudio();

  return (
    <div className="flex flex-col h-full">
      {/* Transition */}
      <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Transition
        </label>
        <Select value={transitionType} onValueChange={v => setTransitionType(v as TransitionType)}>
          <SelectTrigger className="w-full text-sm mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSITIONS.map(t => (
              <SelectItem key={t.value} value={t.value} className="text-sm">{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Scene tiles */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {scenes.length === 0 ? (
          <p className="text-xs text-muted-foreground/70 leading-relaxed py-6 text-center">
            No live sources yet. Turn on a camera, share your screen, load slides,
            cue a video, or invite a guest — they'll appear here as scenes you can
            switch between.
          </p>
        ) : (
          scenes.map(scene => <SceneTile key={scene.id} scene={scene} />)
        )}

        {/* Add a media source from the Library (it becomes a scene once cued). */}
        <button
          onClick={() => setActivePanel('stock')}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors py-3"
          title="Add a video or excerpt from your Media Library"
        >
          <Plus className="h-3.5 w-3.5" /> Add media source
        </button>
      </div>
    </div>
  );
}
