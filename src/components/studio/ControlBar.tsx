import { useStudio } from '@/contexts/StudioContext';
import { useTeleprompter } from '@/contexts/TeleprompterContext';
import {
  Mic, MicOff, Video, VideoOff, Monitor,
  Presentation, UserPlus, Settings, ScrollText,
} from 'lucide-react';
import { ControlButton } from './ControlButton';
import { RecordActionButton } from './RecordActionButton';
import { CameraQuickSettings } from './CameraQuickSettings';
import { MicQuickSettings } from './MicQuickSettings';
import { useRef, useState } from 'react';

export function ControlBar() {
  const {
    isCameraOn, isMicOn, isScreenSharing, cameraStream,
    toggleCamera, toggleMic, toggleScreenShare,
    slideshow, closeSlideshow, activePanel, setActivePanel, forgeChatUnread,
  } = useStudio();
  const { visible: teleprompterVisible, setVisible: setTeleprompterVisible } = useTeleprompter();

  // Device acquisition takes 0.5–2s — show a spinner and swallow re-clicks
  // so the buttons always visibly respond.
  const [busy, setBusy] = useState<'cam' | 'screen' | null>(null);
  const runBusy = (key: 'cam' | 'screen', fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  // Pressing any other control-bar button while the teleprompter overlay is
  // showing clears it (turns it to "Hide") — the teleprompter's own button is
  // exempt since it manages its own visibility.
  const teleprompterBtnRef = useRef<HTMLDivElement>(null);
  const hideTeleprompterOnOtherClicks = (e: React.MouseEvent) => {
    if (!teleprompterVisible) return;
    if (teleprompterBtnRef.current?.contains(e.target as Node)) return;
    setTeleprompterVisible(false);
  };

  return (
    <div
      className="h-16 bg-background flex items-center justify-center gap-2 px-4 shrink-0"
      onClickCapture={hideTeleprompterOnOtherClicks}
    >
      <div className="relative">
        <ControlButton
          onClick={toggleMic}
          active={cameraStream ? isMicOn : undefined}
          disabled={!cameraStream}
          label={!cameraStream ? 'Enable the camera first — the mic is captured with it' : isMicOn ? 'Mute Microphone (M)' : 'Unmute Microphone (M)'}
        >
          {isMicOn && cameraStream ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </ControlButton>
        <MicQuickSettings />
      </div>

      <div className="relative">
        <ControlButton
          onClick={runBusy('cam', toggleCamera)}
          active={isCameraOn}
          busy={busy === 'cam'}
          label={isCameraOn ? 'Stop Camera (C)' : 'Start Camera (C)'}
        >
          {isCameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </ControlButton>
        <CameraQuickSettings />
      </div>

      <ControlButton
        onClick={runBusy('screen', toggleScreenShare)}
        active={isScreenSharing && !slideshow ? true : undefined}
        busy={busy === 'screen'}
        label={isScreenSharing && !slideshow ? 'Stop Screen Share (S)' : 'Share Screen (S)'}
      >
        <Monitor className="h-5 w-5" />
      </ControlButton>

      {/* Invite — opens the same side panel the sidebar used to; the unread
          Forge Chat blink rides along so the host still notices guest messages. */}
      {(() => {
        const inviteActive = activePanel === 'interact';
        const showChatAlert = forgeChatUnread > 0 && !inviteActive;
        return (
          <div className="relative">
            <ControlButton
              onClick={() => setActivePanel(inviteActive ? null : 'interact')}
              active={inviteActive ? true : undefined}
              label={`Invite${showChatAlert ? ' · new message' : ''}`}
            >
              <UserPlus className="h-5 w-5" />
            </ControlButton>
            {showChatAlert && (
              <span className="pointer-events-none absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-live ring-2 ring-card animate-pulse-live" />
            )}
          </div>
        );
      })()}

      {(() => {
        const slidesActive = activePanel === 'slides';
        // Opens the Slides library panel. Stays highlighted while a deck is
        // live so the presenting state is still visible with the panel closed.
        // Clicking it off while presenting ends the deck and returns the
        // broadcast to the video source (camera).
        return (
          <ControlButton
            onClick={() => {
              if (slideshow) {
                closeSlideshow();
                setActivePanel(null);
                // Return to the video source: if the camera is off the stage
                // would otherwise fall to "No video source" — bring it back.
                if (!isCameraOn) void toggleCamera();
              } else {
                setActivePanel(slidesActive ? null : 'slides');
              }
            }}
            active={slidesActive || slideshow ? true : undefined}
            label={slideshow ? `Slides — presenting slide ${slideshow.current}/${slideshow.total} · click to return to camera` : 'Slides'}
          >
            <Presentation className="h-5 w-5" />
          </ControlButton>
        );
      })()}

      {(() => {
        const teleprompterActive = activePanel === 'teleprompter';
        // Toggling off closes the panel AND clears the on-screen prompt (mirrors
        // the panel's Hide); toggling on reopens it and shows the overlay again.
        return (
          <div ref={teleprompterBtnRef}>
            <ControlButton
              onClick={() => {
                if (teleprompterActive) {
                  setActivePanel(null);
                  setTeleprompterVisible(false);
                } else {
                  setActivePanel('teleprompter');
                  setTeleprompterVisible(true);
                }
              }}
              active={teleprompterActive ? true : undefined}
              label="Teleprompter"
            >
              <ScrollText className="h-5 w-5" />
            </ControlButton>
          </div>
        );
      })()}

      {(() => {
        const settingsActive = activePanel === 'av';
        return (
          <ControlButton
            onClick={() => setActivePanel(settingsActive ? null : 'av')}
            active={settingsActive ? true : undefined}
            label="Settings"
          >
            <Settings className="h-5 w-5" />
          </ControlButton>
        );
      })()}

      <div className="w-px h-8 bg-border mx-1" />

      <RecordActionButton />
    </div>
  );
}
