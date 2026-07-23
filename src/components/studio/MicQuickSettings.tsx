import { useStudio } from '@/contexts/StudioContext';
import { useAudioLevel } from '@/hooks/useAudioLevel';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { QuickSettingsPopover } from './QuickSettingsPopover';

const SEGMENTS = 12;
// Whether the browser lets us route audio to a chosen output device.
const CAN_PICK_SPEAKER = typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function';

/** A short 440 Hz beep on the chosen output device, so the host can confirm
 * they'll hear the stream. Routed through a MediaStream so setSinkId applies. */
async function playTestTone(sinkId?: string | null) {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 440;
  osc.connect(gain).connect(dest);

  const audio = new Audio();
  audio.srcObject = dest.stream;
  if (sinkId && 'setSinkId' in audio) {
    try { await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(sinkId); }
    catch { /* fall back to the default output */ }
  }
  await audio.play().catch(() => { /* autoplay policy — the gesture covers it */ });

  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  osc.start(t);
  osc.stop(t + 0.6);
  osc.onended = () => { audio.pause(); void ctx.close().catch(() => { /* already closed */ }); };
}

/** Segmented input-level meter, styled after a hardware VU strip: green for
 * healthy levels, amber approaching hot, red at the top for clipping. */
function LevelMeter({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1 h-3" aria-hidden>
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const lit = level >= ((i + 1) / SEGMENTS) * 100;
        const tone =
          i >= SEGMENTS - 2 ? 'bg-destructive'
            : i >= SEGMENTS - 4 ? 'bg-accent'
              : 'bg-success';
        return (
          <span
            key={i}
            className={`flex-1 h-full rounded-sm transition-colors duration-75 ${lit ? tone : 'bg-secondary'}`}
          />
        );
      })}
    </div>
  );
}

/** Quick microphone settings, opened from the corner arrow on the mic button:
 * the input device picker, a live level meter, output-device selection, and a
 * test-tone button. */
export function MicQuickSettings() {
  const { cameraStream, audioDevices, selectedMicId, selectMic, refreshDevices } = useStudio();

  return (
    <QuickSettingsPopover ariaLabel="Microphone settings" widthClass="w-72">
      {open => <MicPanel {...{ open, cameraStream, audioDevices, selectedMicId, selectMic, refreshDevices }} />}
    </QuickSettingsPopover>
  );
}

function MicPanel({
  open, cameraStream, audioDevices, selectedMicId, selectMic, refreshDevices,
}: {
  open: boolean;
  cameraStream: MediaStream | null;
  audioDevices: MediaDeviceInfo[];
  selectedMicId: string | null;
  selectMic: (id: string) => void | Promise<void>;
  refreshDevices: () => void | Promise<void>;
}) {
  // Meter runs off the program mic (captured with the camera); only while open.
  const level = useAudioLevel(open ? cameraStream : null);
  const micLabelsKnown = audioDevices.some(d => d.label);

  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [speakerId, setSpeakerId] = useState<string | null>(() => localStorage.getItem('studio-speaker-id'));
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open || !CAN_PICK_SPEAKER) return;
    navigator.mediaDevices.enumerateDevices()
      .then(ds => setSpeakers(ds.filter(d => d.kind === 'audiooutput')))
      .catch(() => { /* enumeration blocked — leave the picker out */ });
  }, [open]);

  const pickSpeaker = (id: string) => {
    setSpeakerId(id);
    localStorage.setItem('studio-speaker-id', id);
  };

  const test = async () => {
    setTesting(true);
    try { await playTestTone(speakerId); }
    finally { setTimeout(() => setTesting(false), 650); }
  };

  const showSpeakerPicker = CAN_PICK_SPEAKER && speakers.some(d => d.label);

  return (
    <>
      {/* Microphone device */}
      <label className="text-sm font-semibold text-foreground block mb-1.5">Microphone</label>
      <Select
        value={selectedMicId ?? undefined}
        onValueChange={selectMic}
        onOpenChange={o => { if (o && !micLabelsKnown) void refreshDevices(); }}
      >
        <SelectTrigger className="w-full h-10">
          <SelectValue placeholder={micLabelsKnown ? 'Choose microphone' : 'Default microphone'} />
        </SelectTrigger>
        <SelectContent>
          {audioDevices.map((d, i) => (
            <SelectItem key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Live input level */}
      <div className="mt-3">
        <LevelMeter level={level} />
      </div>

      {/* Speaker device */}
      {showSpeakerPicker && (
        <>
          <label className="text-sm font-semibold text-foreground block mt-4 mb-1.5">Speaker</label>
          <Select value={speakerId ?? undefined} onValueChange={pickSpeaker}>
            <SelectTrigger className="w-full h-10">
              <SelectValue placeholder="Default speaker" />
            </SelectTrigger>
            <SelectContent>
              {speakers.map((d, i) => (
                <SelectItem key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Speaker ${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}

      {/* Test speaker */}
      <Button
        variant="secondary"
        onClick={test}
        disabled={testing}
        className={`w-full h-10 gap-2 font-semibold ${showSpeakerPicker ? 'mt-3' : 'mt-4'}`}
      >
        <Volume2 className="h-4 w-4" />
        {testing ? 'Playing…' : 'Test speaker'}
      </Button>
    </>
  );
}
