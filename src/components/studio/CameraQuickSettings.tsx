import { useStudio, QUALITY_PRESETS, type CaptureQuality, type StreamOrientation } from '@/contexts/StudioContext';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { VideoOff } from 'lucide-react';
import { QuickSettingsPopover } from './QuickSettingsPopover';

// Friendly, honest resolution labels (fps isn't host-controlled, so it's not
// implied here). Order mirrors the quality ladder.
const RESOLUTIONS: Array<{ id: CaptureQuality; label: string }> = [
  { id: '720p', label: `High Definition (720p)` },
  { id: '1080p', label: `Full HD (1080p)` },
  { id: '4k', label: `Ultra HD (4K)` },
];

const ORIENTATIONS: Array<{ id: StreamOrientation; label: string; dims: string }> = [
  { id: 'landscape', label: 'Landscape', dims: '1920×1080' },
  { id: 'portrait', label: 'Portrait', dims: '1080×1920' },
];

/** Quick camera settings, opened from the corner arrow on the camera button:
 * a live self-view, the camera device picker, capture resolution, and a
 * preview-only mirror toggle. Mirrors the layout of a standard device-setup
 * panel. */
export function CameraQuickSettings() {
  const {
    cameraStream, isCameraOn,
    videoDevices, selectedCameraId, switchCamera, hardRefreshDevices,
    captureQuality, setCaptureQuality,
    orientation, setOrientation, isLive,
    mirrorPreview, setMirrorPreview,
  } = useStudio();

  const labelsKnown = videoDevices.some(d => d.label);

  return (
    <QuickSettingsPopover ariaLabel="Camera settings" widthClass="w-72">
      {() => (<>
      {/* Self-view */}
      <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-secondary/60 mb-4">
        {isCameraOn && cameraStream ? (
          <video
            ref={node => { if (node && node.srcObject !== cameraStream) node.srcObject = cameraStream; }}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-cover ${mirrorPreview ? '-scale-x-100' : ''}`}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <VideoOff className="h-7 w-7 text-muted-foreground/50" />
          </div>
        )}
      </div>

      {/* Camera device */}
      <label className="text-sm font-semibold text-foreground block mb-1.5">Camera</label>
      <Select
        value={selectedCameraId ?? undefined}
        onValueChange={switchCamera}
        onOpenChange={open => { if (open && !labelsKnown) void hardRefreshDevices(); }}
      >
        <SelectTrigger className="w-full h-10">
          <SelectValue placeholder={labelsKnown ? 'Choose camera' : 'Default camera'} />
        </SelectTrigger>
        <SelectContent>
          {videoDevices.map((d, i) => (
            <SelectItem key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Resolution */}
      <label className="text-sm font-semibold text-foreground block mt-4 mb-1.5">Resolution</label>
      <Select value={captureQuality} onValueChange={v => void setCaptureQuality(v as CaptureQuality)}>
        <SelectTrigger className="w-full h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RESOLUTIONS.map(r => (
            <SelectItem key={r.id} value={r.id}>
              {r.label}
              <span className="text-muted-foreground ml-1">
                · {QUALITY_PRESETS[r.id].width}×{QUALITY_PRESETS[r.id].height}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Orientation — can't change mid-broadcast, so it locks while live. */}
      <label className="text-sm font-semibold text-foreground block mt-4 mb-1.5">Orientation</label>
      <Select
        value={orientation}
        onValueChange={v => void setOrientation(v as StreamOrientation)}
        disabled={isLive}
      >
        <SelectTrigger className="w-full h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ORIENTATIONS.map(o => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
              <span className="text-muted-foreground ml-1">· {o.dims}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isLive && (
        <p className="text-[11px] text-muted-foreground mt-1.5">End the stream to change orientation.</p>
      )}

      {/* Mirror */}
      <div className="flex items-center gap-3 mt-4">
        <Switch checked={mirrorPreview} onCheckedChange={setMirrorPreview} aria-label="Mirror my video" />
        <span className="text-sm font-medium text-foreground">Mirror my video</span>
      </div>
      </>)}
    </QuickSettingsPopover>
  );
}
