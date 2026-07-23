import { useStudio, QUALITY_PRESETS, type CaptureQuality } from '@/contexts/StudioContext';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, X, Wifi, RefreshCw, Radio, PictureInPicture2, CameraOff } from 'lucide-react';
import { useEffect, useState } from 'react';

const MAX_CAMERAS = 5;

interface CameraSlot {
  id: string;
  deviceId: string | null;
}

function loadSlots(): CameraSlot[] {
  try {
    const raw = localStorage.getItem('studio-camera-slots');
    const parsed = raw ? JSON.parse(raw) as CameraSlot[] : null;
    if (parsed?.length) return parsed.slice(0, MAX_CAMERAS);
  } catch { /* fresh start */ }
  return [{ id: crypto.randomUUID(), deviceId: null }];
}

export function SourceManager() {
  const {
    isCameraOn, toggleCamera,
    captureQuality, setCaptureQuality, cameraStream, camera2Stream,
    videoDevices, hardRefreshDevices, selectedCameraId, selectedCamera2Id,
    isCamera2On, switchCamera, setPipCamera,
  } = useStudio();

  const [slots, setSlots] = useState<CameraSlot[]>(loadSlots);
  const [rescanning, setRescanning] = useState(false);

  const handleRescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    try {
      await hardRefreshDevices();
    } finally {
      setRescanning(false);
    }
  };

  // After a rescan, unbind slots whose device disappeared
  useEffect(() => {
    if (!videoDevices.some(d => d.label)) return; // labels unknown — don't judge
    setSlots(prev => {
      const known = new Set(videoDevices.map(d => d.deviceId));
      const next = prev.map(s => (s.deviceId && !known.has(s.deviceId) ? { ...s, deviceId: null } : s));
      return next.some((s, i) => s !== prev[i]) ? next : prev;
    });
  }, [videoDevices]);

  useEffect(() => {
    localStorage.setItem('studio-camera-slots', JSON.stringify(slots));
  }, [slots]);

  // Bind the first slot to the resolved default camera (e.g. FaceTime HD)
  // so the picker shows it instead of an empty placeholder
  useEffect(() => {
    if (selectedCameraId && slots[0] && !slots[0].deviceId) {
      setSlots(prev => prev.map((s, i) => (i === 0 ? { ...s, deviceId: selectedCameraId } : s)));
    }
  }, [selectedCameraId, slots]);

  const activeSettings = cameraStream?.getVideoTracks()[0]?.getSettings();
  const labelsKnown = videoDevices.some(d => d.label);
  const deviceLabel = (deviceId: string | null) => {
    if (!deviceId) return null;
    const idx = videoDevices.findIndex(d => d.deviceId === deviceId);
    return videoDevices[idx]?.label || (idx >= 0 ? `Camera ${idx + 1}` : 'Unavailable device');
  };

  const usedDeviceIds = new Set(slots.map(s => s.deviceId).filter(Boolean));
  const nextFreeDevice = videoDevices.find(d => !usedDeviceIds.has(d.deviceId))?.deviceId ?? null;

  const addSlot = () => {
    if (slots.length >= MAX_CAMERAS) return;
    setSlots(prev => [...prev, { id: crypto.randomUUID(), deviceId: nextFreeDevice }]);
  };

  const removeSlot = (slot: CameraSlot) => {
    // Turn off whatever this slot was driving
    if (slot.deviceId && slot.deviceId === selectedCameraId && isCameraOn) toggleCamera();
    if (slot.deviceId && slot.deviceId === selectedCamera2Id && isCamera2On) setPipCamera(null);
    setSlots(prev => prev.filter(s => s.id !== slot.id));
  };

  const setSlotDevice = (slot: CameraSlot, deviceId: string) => {
    setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, deviceId } : s));
    // If this slot is currently live/PiP, follow the hardware change
    if (slot.deviceId === selectedCameraId && isCameraOn) switchCamera(deviceId);
    else if (slot.deviceId === selectedCamera2Id && isCamera2On) setPipCamera(deviceId);
  };

  const isLiveSlot = (s: CameraSlot) => !!s.deviceId && s.deviceId === selectedCameraId && isCameraOn;
  const isPipSlot = (s: CameraSlot) => !!s.deviceId && s.deviceId === selectedCamera2Id && isCamera2On;

  return (
    <div className="space-y-5">
      {/* Camera switcher */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Cameras ({slots.length}/{MAX_CAMERAS})
          </h3>
          <button
            onClick={handleRescan}
            disabled={rescanning}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
            title="Clean rescan — releases all cameras, re-detects devices fresh, and restores active feeds"
          >
            <RefreshCw className={`h-3 w-3 ${rescanning ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-2">
          {slots.map((slot, i) => {
            const live = isLiveSlot(slot);
            const pip = isPipSlot(slot);
            return (
              <div
                key={slot.id}
                className={`rounded-lg p-2.5 space-y-2 border transition-colors ${
                  live ? 'border-live/60 bg-live/5' : pip ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    Camera {i + 1}
                    {live && (
                      <span className="text-[10px] font-bold text-live tracking-wider flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-live animate-pulse-live" /> LIVE
                      </span>
                    )}
                    {pip && <span className="text-[10px] font-bold text-primary tracking-wider">PiP</span>}
                  </span>
                  {slots.length > 1 && (
                    <button
                      onClick={() => removeSlot(slot)}
                      className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove camera"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <Select
                  value={slot.deviceId ?? undefined}
                  onValueChange={v => setSlotDevice(slot, v)}
                >
                  <SelectTrigger className="w-full text-xs h-8">
                    <SelectValue placeholder={labelsKnown ? 'Choose device' : 'Default camera (go live once to list devices)'} />
                  </SelectTrigger>
                  <SelectContent>
                    {videoDevices.map((d, di) => (
                      <SelectItem key={d.deviceId || di} value={d.deviceId} className="text-xs">
                        {d.label || `Camera ${di + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    size="sm"
                    variant={live ? 'destructive' : 'default'}
                    className="h-7 gap-1.5 text-[11px]"
                    onClick={() => {
                      if (live) { toggleCamera(); return; }
                      if (slot.deviceId) {
                        // Can't be program and PiP at once
                        if (pip) setPipCamera(null);
                        switchCamera(slot.deviceId);
                      }
                    }}
                    disabled={!live && !slot.deviceId}
                  >
                    {live ? <CameraOff className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
                    {live ? 'Stop' : 'Go Live'}
                  </Button>
                  <Button
                    size="sm"
                    variant={pip ? 'default' : 'outline'}
                    className="h-7 gap-1.5 text-[11px]"
                    onClick={() => setPipCamera(pip ? null : slot.deviceId)}
                    disabled={!slot.deviceId || live}
                    title={live ? 'The live camera can\'t also be PiP' : undefined}
                  >
                    <PictureInPicture2 className="h-3 w-3" />
                    {pip ? 'PiP On' : 'PiP'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={addSlot}
          disabled={slots.length >= MAX_CAMERAS}
          className="w-full gap-2 text-xs mt-2"
        >
          <Plus className="h-3.5 w-3.5" />
          {slots.length >= MAX_CAMERAS ? 'Maximum 5 cameras' : 'Add Camera'}
        </Button>

        {isCameraOn && activeSettings?.width && (
          <p className="text-[11px] text-success mt-2 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Program: {deviceLabel(selectedCameraId) ?? 'camera'} · {activeSettings.width}×{activeSettings.height} · mic active
          </p>
        )}
        {isCamera2On && camera2Stream && (
          <p className="text-[11px] text-primary mt-1 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            PiP: {deviceLabel(selectedCamera2Id) ?? 'camera'} (video only)
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          "Go Live" on a camera cuts the program feed to it instantly — audio
          follows the program camera.
        </p>
      </div>

      {/* Capture Quality */}
      <div className="border-t border-border pt-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Capture Quality</h3>
        <Select value={captureQuality} onValueChange={v => setCaptureQuality(v as CaptureQuality)}>
          <SelectTrigger className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(QUALITY_PRESETS) as CaptureQuality[]).map(q => (
              <SelectItem key={q} value={q} className="text-xs">
                {QUALITY_PRESETS[q].label} ({QUALITY_PRESETS[q].width}×{QUALITY_PRESETS[q].height})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          Applies to cameras, screen capture, and recordings. Broadcasts stream
          at up to 1080p.
        </p>
      </div>

      {/* NDI / Mevo guidance */}
      <div className="border-t border-border pt-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Wifi className="h-3 w-3" /> NDI &amp; Mevo Cameras
        </h3>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Network cameras like the <strong className="text-foreground">Logitech Mevo</strong> work
          here once they're exposed as a system camera:
        </p>
        <ul className="text-[11px] text-muted-foreground mt-2 space-y-1.5 list-disc pl-4 leading-relaxed">
          <li>
            <strong className="text-foreground">Mevo:</strong> enable <em>Webcam mode</em> in the
            Mevo app (or connect via USB) — it appears in the device lists above.
          </li>
          <li>
            <strong className="text-foreground">Any NDI source:</strong> install the free{' '}
            <a
              href="https://ndi.video/tools/"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              NDI Tools
            </a>{' '}
            and run <em>Webcam Input</em> — the NDI feed becomes a selectable
            camera. Then hit rescan (↻).
          </li>
        </ul>
      </div>
    </div>
  );
}
