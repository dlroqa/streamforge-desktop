import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useStreamDestinations } from '@/hooks/useStreamDestinations';
import { useAuth, displayNameOf } from '@/contexts/AuthContext';
import { startStream, stopStream, getStreamStatus, prepareRoom } from '@/lib/streamApi';
import { StreamCompositor, NEUTRAL_GRADE, EQ_NEUTRAL, PIP_DEFAULT_POSITION, type CompositorInputs, type ColorGrade, type EqGains, type PipPosition, type GuestLayout, type ProgramSource, type TransitionType } from '@/lib/streamCompositor';
import { AUDIO_EFFECTS_NEUTRAL, AUDIO_PRESETS, type AudioEffectsSettings } from '@/lib/audioEffects';
import { openLocalRecording } from '@/lib/localRecordings';
import { pickDefaultDevice } from '@/lib/mediaDevices';
import { putMusicBlob, getMusicBlobUrl, deleteMusicBlob } from '@/lib/musicStore';
import { putControlRoomBlob, getControlRoomBlob, deleteControlRoomBlob } from '@/lib/controlRoomStore';
import { getExcerptUrl, type ExcerptMeta } from '@/lib/excerpts';
import { playForgeChime, evaluateChime } from '@/lib/notificationSound';
import { parseCubeLut, type ParsedLut } from '@/lib/lut';
import { SlideshowController, deckTitleFromName, type SlideshowMeta } from '@/lib/slideshow';
import { getAllStoredLuts, putStoredLut, deleteStoredLut } from '@/lib/lutStore';
import { getAssetUrl, putAsset, deleteAsset, putMeta, getMeta } from '@/lib/editorAssets';
import { logActivity } from '@/lib/activityLog';
import { MIC_CHANGED_EVENT } from '@/contexts/TeleprompterContext';

export interface UploadedLut {
  id: string;
  lut: ParsedLut;
}

export type { ParsedLut };

export { NEUTRAL_GRADE };
export type { ColorGrade };
import { supabase } from '@/integrations/supabase/client';
import { useDailyBroadcast, type BroadcastStatus, type StreamHealthStats, type DailyGuest } from '@/hooks/useDailyBroadcast';
import type { ForgeChatMessage } from '@/lib/forgeChat';
import { useToast, toast as notify } from '@/hooks/use-toast';
import { useStreamAnalytics, type StreamAnalytics } from '@/hooks/useStreamAnalytics';
import { useHealthAlerts } from '@/hooks/useHealthAlerts';
import { useRecordings, type Recording, type RecordingMode } from '@/hooks/useRecordings';
import { useScheduledStreams, type ScheduledStream } from '@/hooks/useScheduledStreams';
import { useViewerAnalytics, type PlatformViewerCount } from '@/hooks/useViewerAnalytics';
import { useUnifiedChat, type ChatMessage, type ChatSourceStatus } from '@/hooks/useUnifiedChat';

export type VideoFilter = 'none' | 'grayscale' | 'sepia' | 'contrast' | 'warm' | 'cool' | 'vintage' | 'dramatic';
export type CaptureQuality = '720p' | '1080p' | '4k';

export const QUALITY_PRESETS: Record<CaptureQuality, { width: number; height: number; label: string }> = {
  '720p': { width: 1280, height: 720, label: 'HD 720p' },
  '1080p': { width: 1920, height: 1080, label: 'Full HD 1080p' },
  '4k': { width: 3840, height: 2160, label: '4K UHD' },
};

export type StreamOrientation = 'landscape' | 'portrait';

function cameraConstraints(
  quality: CaptureQuality,
  deviceId?: string,
  withAudio = true,
  micDeviceId?: string | null,
  orientation: StreamOrientation = 'landscape',
): MediaStreamConstraints {
  const preset = QUALITY_PRESETS[quality];
  const portrait = orientation === 'portrait';
  return {
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: portrait ? preset.height : preset.width },
      height: { ideal: portrait ? preset.width : preset.height },
      aspectRatio: { ideal: portrait ? 9 / 16 : 16 / 9 },
      frameRate: { ideal: 30 },
    },
    audio: withAudio
      ? {
          ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      : false,
  };
}
export type SidebarPanel = 'pro' | 'teleprompter' | 'slides' | 'av' | 'interact' | 'graphics' | 'controlroom' | 'archive' | 'stock' | null;

export type { ProgramSource, TransitionType };

/** Kind of source a Scenes-switcher tile represents. */
export type SceneKind = 'camera1' | 'camera2' | 'screen' | 'slides' | 'media' | 'guest';

/** One tile in the Scenes switcher, derived live from the current studio
 * sources. Clicking it cuts the program bus to that source. */
export interface Scene {
  /** Stable id: 'camera1' | 'camera2' | 'screen' | 'slides' | 'media' |
   * `guest:${sessionId}`. */
  id: string;
  kind: SceneKind;
  label: string;
  /** Live feed for the tile thumbnail (null when the source has no video). */
  stream: MediaStream | null;
  /** Whether the tile shows a volume control (media + guest sources). */
  hasAudio: boolean;
  /** Guest session id, for guest scenes only. */
  guestId?: string;
}
export type { BroadcastStatus, Recording, RecordingMode, DailyGuest, ChatMessage, ChatSourceStatus };

export interface Destination {
  id: string;
  platform: string;
  name: string;
  streamKey: string;
  streamUrl: string;
  enabled: boolean;
  platformChannelId?: string;
  // Facebook auto-publish: set when connected via OAuth. The Page token itself
  // is write-only (never returned to the client); `autoPublish` just flags that
  // going live will post to the Page automatically — no stream key needed.
  autoPublish?: boolean;
  providerToken?: string;
  providerAccountId?: string;
}

export interface Poll {
  id: string;
  question: string;
  options: { text: string; votes: number }[];
  active: boolean;
}

export interface Question {
  id: string;
  author: string;
  platform: string;
  text: string;
  highlighted: boolean;
  timestamp: Date;
}

export type { ScheduledStream } from '@/hooks/useScheduledStreams';

// Lower-third model + fonts now live in the shared leaf module so the video
// editor can draw the same block without touching the live pipeline.
// Re-exported here so existing studio consumers keep their import path.
export {
  LOWER_THIRD_FONTS, DEFAULT_LOWER_THIRD_STYLE, lowerThirdFontStack,
  type LowerThirdShape, type LowerThirdFontId, type LowerThirdAlign, type LowerThirdStyle,
} from '@/lib/lowerThird';
import { DEFAULT_LOWER_THIRD_STYLE, type LowerThirdStyle } from '@/lib/lowerThird';

/** Saved lower-thirds deck from a previous session (null = nothing usable).
 * Each item is sanitized field-by-field so an old or corrupt save can't
 * poison the studio; unknown style fields fall back to the defaults. */
const LOWER_THIRDS_KEY = 'studio-lower-thirds';
// Motion-graphic logo overlay pointer: Motion Library asset id + placement.
const MOTION_LOGO_KEY = 'studio-motion-logo';
function loadSavedLowerThirds(): LowerThirdItem[] | null {
  try {
    const raw = localStorage.getItem(LOWER_THIRDS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((item: Partial<LowerThirdItem> | null) => ({
      id: typeof item?.id === 'string' ? item.id : crypto.randomUUID(),
      title: typeof item?.title === 'string' ? item.title : '',
      subtitle: typeof item?.subtitle === 'string' ? item.subtitle : '',
      style: { ...DEFAULT_LOWER_THIRD_STYLE, ...(typeof item?.style === 'object' ? item.style : null) },
    }));
  } catch {
    return null;
  }
}

/** Rendered lower third (the cued item, or hidden) — compositor input shape */
export interface LowerThird {
  title: string;
  subtitle: string;
  visible: boolean;
  style: LowerThirdStyle;
}

/** A saved lower third in the deck; one can be cued on air at a time */
export interface LowerThirdItem {
  id: string;
  title: string;
  subtitle: string;
  style: LowerThirdStyle;
}

/** Uploaded logo/watermark overlay: still image or looping video.
 * Position/scale are fractions of the canvas so they are
 * resolution-independent; x/y is the logo's center. */
export interface LogoOverlay {
  url: string;
  kind: 'image' | 'video';
  x: number;       // 0–1
  y: number;       // 0–1
  scale: number;   // width as fraction of canvas width
  opacity: number; // 0–100
  visible: boolean;
}

/** Maximum "source" buttons the Control Room bank can hold. */
export const CONTROL_ROOM_MAX = 20;

/** One graphic "source" button in the Control Room bank. The bank can hold up
 * to {@link CONTROL_ROOM_MAX}; exactly one is live at a time (loaded into the
 * single broadcast overlay slot). Persisted per browser (localStorage metadata +
 * IndexedDB blobs), so the bank is restored on the next visit. */
export interface ControlRoomSource {
  id: string;
  /** The graphic itself, kept so it can be (re)loaded on air on demand. */
  file: File;
  /** Object URL for the button's own preview (independent of the on-air copy). */
  url: string;
  kind: 'image' | 'video';
  /** Motion Library asset id when the render was saved (else session-only). */
  libraryId?: string;
  /** IndexedDB blob key — how this source's graphic is persisted across sessions. */
  assetId: string;
  /** Editable button label, shown in the middle of the square. */
  name: string;
  /** #rrggbb label colour, combined with {@link alpha} for a translucent tint. */
  color: string;
  /** 0–100 label opacity. */
  alpha: number;
  // Placement used when this source is put on air.
  x: number; y: number; scale: number; opacity: number;
}

export const CONTROL_ROOM_SFX_MAX = 20;

/** One Sound Fx "cue" button in the Control Room. Firing it plays a one-shot
 * sound into the broadcast mix (and the host's monitor). Persisted per user
 * account in the cloud (audio blob in the editor-assets bucket, cue list in the
 * editor_meta table), so a user's cues follow them across devices. */
export interface ControlRoomSound {
  id: string;
  /** Playable object URL (local when just added, or rebuilt from the cloud blob
   * on hydration). */
  url: string;
  /** Cloud asset id (editor-assets bucket) — how the cue's audio is persisted. */
  assetId: string;
  /** Editable button label. */
  name: string;
}

/** Additional microphone source (wireless mics, interfaces, etc.) */
export interface ExtraMic {
  id: string;
  deviceId: string | null;
  volume: number; // 0–100 into the broadcast mix
  stream: MediaStream | null;
}

export const MAX_EXTRA_MICS = 4; // + camera mic = 5 audio sources total

/** A music track in the broadcast music bed (uploaded file or Suno song). */
export interface MusicTrack {
  id: string;
  name: string;
  /** Playable object URL (revoked when the track is removed). */
  url: string;
  source: 'upload' | 'suno';
  /** IndexedDB blob key — how the track is persisted across sessions. */
  assetId: string;
}

// ── Music-bed persistence (localStorage metadata + IndexedDB blobs) ──
const MUSIC_TRACKS_KEY = 'studio-music-tracks';
const MUSIC_SETTINGS_KEY = 'studio-music-settings';

interface SavedMusicTrack { id: string; name: string; source: 'upload' | 'suno'; assetId: string; }

function loadMusicTrackList(): SavedMusicTrack[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MUSIC_TRACKS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is SavedMusicTrack =>
      !!t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.assetId === 'string');
  } catch { return []; }
}

function loadMusicSettings(): { volume: number; loop: boolean; monitor: boolean } {
  const fallback = { volume: 70, loop: false, monitor: false };
  try {
    const s = JSON.parse(localStorage.getItem(MUSIC_SETTINGS_KEY) || '{}');
    return {
      volume: typeof s.volume === 'number' ? s.volume : fallback.volume,
      loop: !!s.loop,
      monitor: !!s.monitor,
    };
  } catch { return fallback; }
}

// ── Control Room persistence (localStorage metadata + IndexedDB blobs) ──
const CONTROL_ROOM_KEY = 'studio-control-room-sources';

/** The persisted shape of a Control Room source: everything except the runtime
 * File / object URL, which are rebuilt from the blob referenced by assetId. */
interface SavedControlRoomSource {
  id: string;
  kind: 'image' | 'video';
  libraryId?: string;
  assetId: string;
  name: string;
  color: string;
  alpha: number;
  fileName: string;
  fileType: string;
  x: number; y: number; scale: number; opacity: number;
}

function loadControlRoomSources(): SavedControlRoomSource[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CONTROL_ROOM_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is SavedControlRoomSource =>
      !!s && typeof s.id === 'string' && typeof s.assetId === 'string' &&
      (s.kind === 'image' || s.kind === 'video'));
  } catch { return []; }
}

// ── Control Room Sound Fx persistence (account-scoped cloud) ──
// The cue list (id + assetId + name) is stored per user in the editor_meta
// table under this key; each cue's audio blob lives in the editor-assets bucket
// under the user's folder. So a user's cues follow them across devices.
const CONTROL_ROOM_SFX_META_KEY = 'control-room-sounds';

/** The persisted shape of a cue: everything except the runtime playable URL,
 * which is rebuilt from the cloud blob referenced by assetId. */
interface SavedControlRoomSound {
  id: string;
  assetId: string;
  name: string;
}

interface StudioContextType {
  uploadVideoFile: (file: File, title?: string) => Promise<boolean>;
  themeMode: 'night' | 'day';
  toggleTheme: () => void;
  activePanel: SidebarPanel;
  setActivePanel: (panel: SidebarPanel) => void;
  /** Which Graphic Interface accordion section is open (e.g. 'motion'). Lets
   * other panels deep-link into a specific section. */
  graphicsSection: string;
  setGraphicsSection: (section: string) => void;
  /** Which Media Library tab is open ('excerpts' | 'stock' | 'soundfx'). Lets
   * the Control Room deep-link straight into the Sound Fx browser. */
  mediaLibrarySection: string;
  setMediaLibrarySection: (section: string) => void;
  isLive: boolean;
  isStartingLive: boolean;
  isStoppingLive: boolean;
  /** In the waiting room (backstage): joined with guests but NOT broadcasting. */
  isBackstage: boolean;
  /** True while the Enter Waiting Room connection is being established. */
  isEnteringBackstage: boolean;
  /** Join the Daily room with guests to prep, without starting the broadcast. */
  enterWaitingRoom: () => Promise<void>;
  /** Leave the waiting room without going live (keeps the room for guests). */
  leaveWaitingRoom: () => Promise<void>;
  /** Shared topic/agenda note the host writes; every guest sees it live. */
  backstageBrief: string;
  setBackstageBrief: (text: string) => void;
  isRecording: boolean;
  isCameraOn: boolean;
  isMicOn: boolean;
  isScreenSharing: boolean;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  toggleCamera: () => Promise<void>;
  captureQuality: CaptureQuality;
  setCaptureQuality: (q: CaptureQuality) => Promise<void>;
  /** Flip the host's self-view horizontally (preview only — the broadcast feed
   * is never mirrored). Persisted per-device. */
  mirrorPreview: boolean;
  setMirrorPreview: (v: boolean) => void;
  orientation: StreamOrientation;
  setOrientation: (o: StreamOrientation) => Promise<void>;
  // Camera hardware selection & second camera source
  videoDevices: MediaDeviceInfo[];
  refreshDevices: () => Promise<void>;
  /** Full clean re-detection: releases camera hardware, probes permissions
   * fresh (so new devices/labels appear), re-enumerates, drops stale
   * selections, and restores captures that were running. */
  hardRefreshDevices: () => Promise<void>;
  selectedCameraId: string | null;
  selectCamera: (deviceId: string) => Promise<void>;
  camera2Stream: MediaStream | null;
  isCamera2On: boolean;
  selectedCamera2Id: string | null;
  setSelectedCamera2Id: (id: string | null) => void;
  toggleCamera2: () => Promise<void>;
  switchCamera: (deviceId: string) => Promise<void>;
  setPipCamera: (deviceId: string | null) => Promise<void>;
  // Primary microphone selection
  selectedMicId: string | null;
  selectMic: (deviceId: string) => Promise<void>;
  // Additional microphone sources (camera mic + up to 4 extras = 5 total)
  audioDevices: MediaDeviceInfo[];
  extraMics: ExtraMic[];
  addExtraMic: () => void;
  removeExtraMic: (id: string) => void;
  setExtraMicDevice: (id: string, deviceId: string) => Promise<void>;
  setExtraMicVolume: (id: string, volume: number) => void;
  toggleExtraMic: (id: string) => Promise<void>;
  // Music bed: uploaded / Suno tracks mixed into the outgoing broadcast audio
  musicTracks: MusicTrack[];
  musicPlayingId: string | null;
  musicPlaying: boolean;
  musicVolume: number;
  musicLoop: boolean;
  musicMonitor: boolean;
  /** Add an audio File to the music bed (persisted); returns the new track id. */
  addMusicFile: (file: File, name?: string, source?: 'upload' | 'suno') => Promise<string>;
  removeMusicTrack: (id: string) => void;
  playMusicTrack: (id: string) => void;
  toggleMusicPlayback: () => void;
  stopMusic: () => void;
  setMusicVolume: (v: number) => void;
  toggleMusicLoop: () => void;
  toggleMusicMonitor: () => void;
  /** Pre-recorded media currently playing as the broadcast source */
  mediaPlayback: { recordingId: string; title: string } | null;
  startMediaPlayback: (recording: Recording) => Promise<boolean>;
  /** Cue an edited Excerpt as the active broadcast video source. */
  startExcerptPlayback: (meta: ExcerptMeta) => Promise<boolean>;
  stopMediaPlayback: () => void;
  /** Whether the active media source is paused, and local audio monitoring. */
  mediaPaused: boolean;
  mediaMonitor: boolean;
  toggleMediaPlayback: () => void;
  toggleMediaMonitor: () => void;
  /** Cue "hold": whether it's on air, playback progress, and hold/resume/seek. */
  mediaOnAir: boolean;
  mediaTime: number;
  mediaDuration: number;
  holdCueToCamera: () => void;
  resumeCue: () => void;
  seekMedia: (t: number) => void;
  /** Whether the camera PiP is hidden over the cued media (clean excerpt). */
  mediaHideCamera: boolean;
  toggleMediaCameraPip: () => void;
  toggleMic: () => void;
  toggleScreenShare: () => Promise<void>;
  /** Slideshow presentation (rides the screen-share channel). Non-null while
   * a deck is loaded; drives the main video source and broadcast. */
  slideshow: SlideshowMeta | null;
  loadSlideshow: (file: File) => Promise<string | null>;
  slideNext: () => void;
  slidePrev: () => void;
  slideGoTo: (n: number) => void;
  closeSlideshow: () => void;
  toggleRecording: () => void;
  goLive: () => Promise<void>;
  stopLive: () => Promise<void>;
  broadcastStatus: BroadcastStatus;
  healthStats: StreamHealthStats | null;
  guests: DailyGuest[];
  ejectGuest: (sessionId: string) => void;
  /** Private host↔guest backstage chat (Forge Chat), separate from stream chat. */
  forgeChat: ForgeChatMessage[];
  sendForgeChat: (text: string) => void;
  /** Count of unread incoming Forge Chat messages (for the attention badge). */
  forgeChatUnread: number;
  /** Mark the Forge Chat as read (clears the unread badge). */
  markForgeChatRead: () => void;
  /** Whether the incoming-guest-message chime is muted. */
  forgeChatSoundMuted: boolean;
  /** Chime volume 0–100. */
  forgeChatSoundVolume: number;
  /** Mute/unmute the incoming-guest-message chime. */
  toggleForgeChatSound: () => void;
  /** Set the chime volume (0–100). */
  setForgeChatSoundVolume: (v: number) => void;
  /** Host + guest arrangement while a guest is on stage (split/pip/solo). */
  guestLayout: GuestLayout;
  setGuestLayout: (layout: GuestLayout) => void;
  // ── Scenes switcher (program bus) ──
  /** Live-derived list of switchable sources (cameras, screen/slides, media,
   * each guest). */
  scenes: Scene[];
  /** Which scene is currently on the program bus (its {@link Scene.id}). */
  activeSceneId: string;
  /** The forced host program source ('auto' = compositor priority). Consumed by
   * the idle preview so a solo host sees switches before going live. */
  program: ProgramSource;
  /** Cut the program bus to a scene, running the chosen transition. */
  takeScene: (id: string) => void;
  /** Transition used when switching scenes (persisted). */
  transitionType: TransitionType;
  setTransitionType: (t: TransitionType) => void;
  /** Whether the left-docked Scenes panel is open. */
  scenesOpen: boolean;
  setScenesOpen: (open: boolean) => void;
  /** Per-guest local monitor volume (0–100), keyed by session id. */
  guestVolumes: Record<string, number>;
  setGuestVolume: (sessionId: string, volume: number) => void;
  /** The composited broadcast stream (video+audio) while live — exactly what
   * viewers see. Used by the preview for true WYSIWYG. */
  compositeStream: MediaStream | null;
  viewerCount: number;
  platformViewers: PlatformViewerCount[] | null;
  streamAnalytics: StreamAnalytics | null;
  showAnalyticsSummary: boolean;
  dismissAnalyticsSummary: () => void;
  volume: number;
  setVolume: (v: number) => void;
  activeFilter: VideoFilter;
  setActiveFilter: (f: VideoFilter) => void;
  colorGrade: ColorGrade;
  updateColorGrade: (patch: Partial<ColorGrade>) => void;
  resetColorGrade: () => void;
  /** Broadcast mic EQ: 4 band gains in dB (−12…+12) */
  eqGains: EqGains;
  setEqBand: (band: keyof EqGains, db: number) => void;
  resetEq: () => void;
  // VST-style mic effects rack (applied after EQ, reaches broadcast + recordings)
  audioEffects: AudioEffectsSettings;
  setAudioEffect: <K extends keyof AudioEffectsSettings>(key: K, value: AudioEffectsSettings[K]) => void;
  applyAudioPreset: (id: string) => void;
  toggleAudioEffects: () => void;
  resetAudioEffects: () => void;
  /** Draggable PiP camera position (tile top-left as scene fraction) */
  pipPosition: PipPosition;
  setPipPosition: (pos: PipPosition) => void;
  /** The cued LUT (null when cued off) — what the preview/broadcast applies */
  lut: ParsedLut | null;
  lutEnabled: boolean;
  /** All LUTs uploaded this session */
  luts: UploadedLut[];
  cuedLutId: string | null;
  loadLutFile: (file: File) => Promise<string | null>;
  cueLut: (id: string | null) => void;
  removeLut: (id: string) => void;
  logo: LogoOverlay | null;
  loadLogoFile: (file: File) => Promise<string | null>;
  updateLogo: (patch: Partial<LogoOverlay>) => void;
  clearLogo: () => void;
  /** Set a generated motion graphic (a Motion Library asset) as the logo
   * overlay. Unlike file uploads this persists across refreshes: the asset id
   * + placement are remembered and the blob is re-fetched on boot. */
  setMotionLogoOverlay: (assetId: string, file: File) => void;
  /** Control Room bank of graphic source buttons (up to CONTROL_ROOM_MAX). */
  controlRoomSources: ControlRoomSource[];
  /** Which source is currently live over the video (null = none on air). */
  activeControlRoomId: string | null;
  /** Add a graphic as a new source button and put it on air. Returns false if
   * the bank is already full. */
  addControlRoomSource: (input: { file: File; kind: 'image' | 'video'; libraryId?: string; name?: string }) => boolean;
  /** Edit a source's label/colour or placement (placement changes apply live
   * when the source is on air). */
  updateControlRoomSource: (id: string, patch: Partial<Pick<ControlRoomSource, 'name' | 'color' | 'alpha' | 'x' | 'y' | 'scale' | 'opacity'>>) => void;
  removeControlRoomSource: (id: string) => void;
  putControlRoomSourceOnAir: (id: string) => void;
  /** Control Room Sound Fx cue buttons (up to CONTROL_ROOM_SFX_MAX). */
  controlRoomSounds: ControlRoomSound[];
  /** Which cue is currently firing (for playing feedback), or null. */
  playingControlRoomSoundId: string | null;
  addControlRoomSound: (input: { file: File; name?: string }) => Promise<boolean>;
  updateControlRoomSound: (id: string, patch: { name: string }) => void;
  removeControlRoomSound: (id: string) => void;
  /** Fire a cue into the broadcast + monitor; re-firing the live cue stops it. */
  playControlRoomSound: (id: string) => void;
  stopControlRoomSound: () => void;
  takeControlRoomOffAir: () => void;
  /** The cued lower third as rendered (hidden placeholder when none cued) */
  lowerThird: LowerThird;
  /** The item being edited, rendered as a temporary (non-broadcast) placeholder. */
  previewLowerThird: LowerThird;
  previewLowerThirdId: string | null;
  setPreviewLowerThirdId: (id: string | null) => void;
  lowerThirds: LowerThirdItem[];
  activeLowerThirdId: string | null;
  addLowerThird: () => string;
  removeLowerThird: (id: string) => void;
  updateLowerThirdItem: (id: string, patch: Partial<Omit<LowerThirdItem, 'id'>>) => void;
  /** Cue an item on air (null = hide) */
  cueLowerThird: (id: string | null) => void;
  destinations: Destination[];
  addDestination: (d: Omit<Destination, 'id'>) => void;
  updateDestination: (
    id: string,
    patch: { name: string; streamUrl: string; platformChannelId?: string; streamKey?: string },
  ) => Promise<boolean>;
  removeDestination: (id: string) => void;
  toggleDestination: (id: string) => void;
  setAllDestinationsEnabled: (enabled: boolean) => Promise<void>;
  polls: Poll[];
  addPoll: (question: string, options: string[]) => void;
  togglePoll: (id: string) => void;
  votePoll: (pollId: string, optionIndex: number) => void;
  removePoll: (id: string) => void;
  questions: Question[];
  addQuestion: (q: Omit<Question, 'id' | 'timestamp' | 'highlighted'>) => void;
  chatMessages: ChatMessage[];
  chatStatuses: ChatSourceStatus[];
  highlightQuestion: (id: string) => void;
  scheduledStreams: ScheduledStream[];
  addScheduledStream: (s: {
    title: string;
    scheduled_at: string;
    platforms: string[];
    recording_id?: string;
    recording_title?: string;
    record_on_stream: boolean;
    record_save_mode?: string;
  }) => Promise<void>;
  removeScheduledStream: (id: string) => Promise<void>;
  // Recordings
  recordings: Recording[];
  recordingsLoading: boolean;
  recordingMode: RecordingMode;
  setRecordingMode: (m: RecordingMode) => void;
  /** Start a recording of the current look — LUT, filter, and corrections are
   * baked into the file (routes through the compositor, never a raw source). */
  startGradedRecording: (title?: string) => Promise<void>;
  stopRecordingWithMode: () => void;
  deleteRecording: (id: string) => Promise<void>;
  getCloudUrl: (path: string) => Promise<string | null>;
  // Auto-record on live
  autoRecordOnLive: boolean;
  setAutoRecordOnLive: (v: boolean) => void;
}

/** localStorage sentinel: the user explicitly cued the LUT off, so don't
 * auto-cue one on reload. Distinct from "no value" (never chose → default on). */
const LUT_CUED_OFF = 'off';

const StudioContext = createContext<StudioContextType | null>(null);

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used within StudioProvider');
  return ctx;
}

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeMode] = useState<'night' | 'day'>(() => {
    return (localStorage.getItem('studio-theme') as 'night' | 'day') || 'night';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('day', themeMode === 'day');
    localStorage.setItem('studio-theme', themeMode);
  }, [themeMode]);

  const toggleTheme = useCallback(() => setThemeMode(m => m === 'night' ? 'day' : 'night'), []);

  const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
  const [graphicsSection, setGraphicsSection] = useState('brand');
  const [mediaLibrarySection, setMediaLibrarySection] = useState('excerpts');
  const [isLive, setIsLive] = useState(false);
  const isLiveRef = useRef(false);
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);
  const [isStartingLive, setIsStartingLive] = useState(false);
  const [isStoppingLive, setIsStoppingLive] = useState(false);
  // Waiting room (backstage): joined to the Daily room with guests, but NOT
  // broadcasting. `isBackstage` is true between Enter Waiting Room and either
  // Go Live (→ isLive) or Leave Waiting Room (→ idle).
  const [isBackstage, setIsBackstage] = useState(false);
  const isBackstageRef = useRef(false);
  useEffect(() => { isBackstageRef.current = isBackstage; }, [isBackstage]);
  const [isEnteringBackstage, setIsEnteringBackstage] = useState(false);
  // The shared topic/agenda note, written by the host, seen by every guest. A
  // prep artifact — persisted locally so it survives a reload.
  const [backstageBrief, setBackstageBriefState] = useState<string>(() => {
    try { return localStorage.getItem('studio-backstage-brief') || ''; } catch { return ''; }
  });
  const setBackstageBrief = useCallback((text: string) => {
    setBackstageBriefState(text);
    try { localStorage.setItem('studio-backstage-brief', text); } catch { /* quota */ }
  }, []);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [volume, setVolume] = useState(75);
  const [activeFilter, setActiveFilter] = useState<VideoFilter>('none');
  const [colorGrade, setColorGrade] = useState<ColorGrade>(NEUTRAL_GRADE);
  const updateColorGrade = useCallback((patch: Partial<ColorGrade>) => {
    setColorGrade(prev => ({ ...prev, ...patch }));
  }, []);
  const resetColorGrade = useCallback(() => setColorGrade(NEUTRAL_GRADE), []);

  // Broadcast mic EQ (4 bands, dB). Persisted — a voice EQ is a room/mic
  // property, not a per-session choice.
  const [eqGains, setEqGains] = useState<EqGains>(() => {
    try {
      const raw = localStorage.getItem('studio-eq');
      if (raw) return { ...EQ_NEUTRAL, ...JSON.parse(raw) as Partial<EqGains> };
    } catch { /* flat */ }
    return EQ_NEUTRAL;
  });
  const setEqBand = useCallback((band: keyof EqGains, db: number) => {
    setEqGains(prev => {
      const next = { ...prev, [band]: Math.max(-12, Math.min(12, Math.round(db))) };
      localStorage.setItem('studio-eq', JSON.stringify(next));
      return next;
    });
  }, []);
  const resetEq = useCallback(() => {
    setEqGains(EQ_NEUTRAL);
    localStorage.setItem('studio-eq', JSON.stringify(EQ_NEUTRAL));
  }, []);

  // VST-style mic effects rack. Persisted like the EQ — an effects chain is a
  // voice/setup choice, not a per-session one.
  const [audioEffects, setAudioEffects] = useState<AudioEffectsSettings>(() => {
    try {
      const raw = localStorage.getItem('studio-audio-fx');
      if (raw) return { ...AUDIO_EFFECTS_NEUTRAL, ...JSON.parse(raw) as Partial<AudioEffectsSettings> };
    } catch { /* neutral */ }
    return AUDIO_EFFECTS_NEUTRAL;
  });
  const persistAudioEffects = useCallback((next: AudioEffectsSettings) => {
    setAudioEffects(next);
    try { localStorage.setItem('studio-audio-fx', JSON.stringify(next)); } catch { /* quota */ }
  }, []);
  const setAudioEffect = useCallback(<K extends keyof AudioEffectsSettings>(key: K, value: AudioEffectsSettings[K]) => {
    setAudioEffects(prev => {
      // Touching a parameter (not the master toggle) drops the preset to custom.
      const markCustom = key !== 'enabled' && key !== 'preset';
      const next = { ...prev, [key]: value, ...(markCustom ? { preset: 'custom' } : {}) };
      try { localStorage.setItem('studio-audio-fx', JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);
  const applyAudioPreset = useCallback((id: string) => {
    const preset = AUDIO_PRESETS.find(p => p.id === id);
    if (!preset) return;
    persistAudioEffects({
      ...AUDIO_EFFECTS_NEUTRAL,
      ...preset.settings,
      preset: id,
      enabled: id !== 'none',
    });
  }, [persistAudioEffects]);
  const toggleAudioEffects = useCallback(() => {
    setAudioEffects(prev => {
      const next = { ...prev, enabled: !prev.enabled };
      try { localStorage.setItem('studio-audio-fx', JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);
  const resetAudioEffects = useCallback(() => persistAudioEffects(AUDIO_EFFECTS_NEUTRAL), [persistAudioEffects]);

  // Draggable PiP camera position — persisted, since it's a scene layout choice
  const [pipPosition, setPipPositionState] = useState<PipPosition>(() => {
    try {
      const raw = localStorage.getItem('studio-pip-pos');
      if (raw) {
        const p = JSON.parse(raw) as PipPosition;
        if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
      }
    } catch { /* default */ }
    return PIP_DEFAULT_POSITION;
  });
  const setPipPosition = useCallback((pos: PipPosition) => {
    setPipPositionState(pos);
    localStorage.setItem('studio-pip-pos', JSON.stringify(pos));
  }, []);

  // Host + guest arrangement (split/pip/solo). Persisted so the host's choice
  // survives reloads; mirrored into the compositor so switching updates the
  // live broadcast canvas immediately.
  const [guestLayout, setGuestLayoutState] = useState<GuestLayout>(() => {
    const raw = localStorage.getItem('studio-guest-layout');
    return raw === 'pip' || raw === 'solo' || raw === 'split' ? raw : 'split';
  });
  const setGuestLayout = useCallback((layout: GuestLayout) => {
    setGuestLayoutState(layout);
    localStorage.setItem('studio-guest-layout', layout);
  }, []);

  // ── Scenes switcher (program bus) ──
  // `program` forces a host source on air; `featuredGuestId` cuts a specific
  // guest full-frame. Both feed the compositor. `activeSceneId` is the derived
  // selection the UI highlights.
  const [program, setProgram] = useState<ProgramSource>('auto');
  const [featuredGuestId, setFeaturedGuestId] = useState<string | null>(null);
  const [scenesOpen, setScenesOpen] = useState(false);
  const [transitionType, setTransitionTypeState] = useState<TransitionType>(() => {
    const raw = localStorage.getItem('studio-scene-transition');
    return raw === 'crossfade' || raw === 'slide' ? raw : 'instant';
  });
  const setTransitionType = useCallback((t: TransitionType) => {
    setTransitionTypeState(t);
    localStorage.setItem('studio-scene-transition', t);
  }, []);
  // Per-guest local monitor volume (0–100). Broadcast guest audio is muxed
  // server-side, so this only affects what the host hears.
  const [guestVolumes, setGuestVolumes] = useState<Record<string, number>>({});
  const setGuestVolume = useCallback((sessionId: string, volume: number) => {
    setGuestVolumes(prev => ({ ...prev, [sessionId]: Math.max(0, Math.min(100, volume)) }));
  }, []);

  // 3D LUT (.cube) library. Uploads are saved to IndexedDB and restored on
  // reload; one LUT may be cued at a time (the pipeline applies a single LUT
  // per frame). Cues default ON: a LUT is cued whenever one is available, and
  // only an explicit cue-off (persisted as the 'off' sentinel) leaves the
  // library uncued across reloads.
  const [luts, setLuts] = useState<UploadedLut[]>([]);
  const [cuedLutId, setCuedLutId] = useState<string | null>(() => {
    const saved = localStorage.getItem('studio-cued-lut');
    return saved && saved !== LUT_CUED_OFF ? saved : null;
  });
  const lut = luts.find(u => u.id === cuedLutId)?.lut ?? null;
  const lutEnabled = !!lut;

  // Restore the saved library once on mount, then reconcile the cue: keep the
  // saved LUT if it still exists; if the saved id is stale or was never set
  // (and the user didn't explicitly cue off), cue the most recent LUT on.
  useEffect(() => {
    let cancelled = false;
    getAllStoredLuts().then(rows => {
      if (cancelled) return;
      setLuts(rows.map(r => ({ id: r.id, lut: { name: r.name, size: r.size, data: r.data, recipe: r.recipe } })));
      if (localStorage.getItem('studio-cued-lut') === LUT_CUED_OFF || !rows.length) return;
      setCuedLutId(prev => {
        if (prev && rows.some(r => r.id === prev)) return prev;
        const latest = rows[rows.length - 1].id; // rows are oldest-first
        localStorage.setItem('studio-cued-lut', latest);
        return latest;
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Returns an error message, or null on success.
  const loadLutFile = useCallback(async (file: File): Promise<string | null> => {
    try {
      const text = await file.text();
      const parsed = parseCubeLut(text, file.name);
      const id = crypto.randomUUID();
      setLuts(prev => [...prev, { id, lut: parsed }]);
      setCuedLutId(id); // a fresh upload cues on
      localStorage.setItem('studio-cued-lut', id);
      await putStoredLut({ id, createdAt: Date.now(), ...parsed });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not read the LUT file';
    }
  }, []);
  /** Cue a library entry on (its id) or cue off (null). Cue-off persists as an
   * explicit choice — it's the only thing that keeps LUTs from applying. */
  const cueLut = useCallback((id: string | null) => {
    setCuedLutId(id);
    localStorage.setItem('studio-cued-lut', id ?? LUT_CUED_OFF);
  }, []);
  const removeLut = useCallback((id: string) => {
    setLuts(prev => prev.filter(u => u.id !== id));
    setCuedLutId(prev => {
      if (prev !== id) return prev;
      // Deleting the cued LUT counts as an explicit cue-off — don't silently
      // swap a different look onto a live output.
      localStorage.setItem('studio-cued-lut', LUT_CUED_OFF);
      return null;
    });
    void deleteStoredLut(id);
  }, []);

  // Logo / watermark overlay
  const [logo, setLogo] = useState<LogoOverlay | null>(null);
  // When the logo is a generated motion graphic, this holds its Motion
  // Library asset id so the overlay survives refreshes (uploads stay
  // session-only — their blobs have nowhere to be re-fetched from).
  const motionLogoAssetId = useRef<string | null>(null);
  const forgetMotionLogo = useCallback(() => {
    motionLogoAssetId.current = null;
    try { localStorage.removeItem(MOTION_LOGO_KEY); } catch { /* best effort */ }
  }, []);
  const loadLogoFile = useCallback(async (file: File): Promise<string | null> => {
    const isImage = file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/gif';
    const isVideo = file.type === 'video/mp4' || file.type === 'video/webm';
    if (!isImage && !isVideo) {
      return 'Unsupported file — use PNG, JPG, or a looping MP4/WebM video';
    }
    forgetMotionLogo();
    setLogo(prev => {
      if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      return {
        url: URL.createObjectURL(file),
        kind: isVideo ? 'video' : 'image',
        x: 0.9,        // top-right by default (classic watermark spot)
        y: 0.1,
        scale: 0.12,
        opacity: 100,
        visible: true,
      };
    });
    return null;
  }, [forgetMotionLogo]);
  const updateLogo = useCallback((patch: Partial<LogoOverlay>) => {
    // A full replacement (new url) from a non-library source drops persistence.
    if (patch.url) forgetMotionLogo();
    setLogo(prev => prev ? { ...prev, ...patch } : (patch.url ? {
      url: patch.url, kind: patch.kind ?? 'image',
      x: patch.x ?? 0.9, y: patch.y ?? 0.1, scale: patch.scale ?? 0.12,
      opacity: patch.opacity ?? 100, visible: patch.visible ?? true,
    } : prev));
  }, [forgetMotionLogo]);
  const clearLogo = useCallback(() => {
    forgetMotionLogo();
    setLogo(prev => {
      if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, [forgetMotionLogo]);
  const setMotionLogoOverlay = useCallback((assetId: string, file: File) => {
    motionLogoAssetId.current = assetId;
    setLogo(prev => {
      if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      // Blob URL (not the remote signed URL) keeps the broadcast canvas untainted.
      return { url: URL.createObjectURL(file), kind: 'video', x: 0.5, y: 0.5, scale: 0.5, opacity: 100, visible: true };
    });
  }, []);

  // ---- Control Room: a bank of graphic "source" buttons, one live at a time
  // (loaded into the single broadcast overlay slot above). Refs mirror state
  // so the callbacks can read the latest bank without re-binding. ----
  const [controlRoomSources, setControlRoomSources] = useState<ControlRoomSource[]>([]);
  const [activeControlRoomId, setActiveControlRoomId] = useState<string | null>(null);
  const controlRoomSourcesRef = useRef<ControlRoomSource[]>([]);
  const activeControlRoomIdRef = useRef<string | null>(null);
  useEffect(() => { controlRoomSourcesRef.current = controlRoomSources; }, [controlRoomSources]);
  useEffect(() => { activeControlRoomIdRef.current = activeControlRoomId; }, [activeControlRoomId]);

  const putControlRoomSourceOnAir = useCallback((id: string) => {
    const src = controlRoomSourcesRef.current.find(s => s.id === id);
    if (!src) return;
    forgetMotionLogo(); // the Control Room owns the on-air selection now
    setActiveControlRoomId(id);
    setLogo(prev => {
      if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      // Fresh copy for the on-air slot, kept separate from the button preview.
      return { url: URL.createObjectURL(src.file), kind: src.kind, x: src.x, y: src.y, scale: src.scale, opacity: src.opacity, visible: true };
    });
  }, [forgetMotionLogo]);

  const takeControlRoomOffAir = useCallback(() => {
    setActiveControlRoomId(null);
    setLogo(prev => {
      if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const addControlRoomSource = useCallback((input: { file: File; kind: 'image' | 'video'; libraryId?: string; name?: string }) => {
    if (controlRoomSourcesRef.current.length >= CONTROL_ROOM_MAX) return false;
    const assetId = crypto.randomUUID();
    // Persist the graphic blob in the background so the bank survives a reload.
    void putControlRoomBlob(input.file, assetId);
    const src: ControlRoomSource = {
      id: crypto.randomUUID(),
      file: input.file,
      url: URL.createObjectURL(input.file),
      kind: input.kind,
      libraryId: input.libraryId,
      assetId,
      name: input.name?.trim() || `Graphic ${controlRoomSourcesRef.current.length + 1}`,
      color: '#ffffff',
      alpha: 100,
      x: 0.5, y: 0.5, scale: 0.5, opacity: 100,
    };
    // Mirror synchronously so putControlRoomSourceOnAir finds it immediately.
    controlRoomSourcesRef.current = [...controlRoomSourcesRef.current, src];
    setControlRoomSources(controlRoomSourcesRef.current);
    putControlRoomSourceOnAir(src.id);
    return true;
  }, [putControlRoomSourceOnAir]);

  const updateControlRoomSource = useCallback((id: string, patch: Partial<Pick<ControlRoomSource, 'name' | 'color' | 'alpha' | 'x' | 'y' | 'scale' | 'opacity'>>) => {
    setControlRoomSources(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
    // Reflect placement edits on the live overlay when this source is on air.
    if (id === activeControlRoomIdRef.current) {
      const live: Partial<LogoOverlay> = {};
      if (patch.x !== undefined) live.x = patch.x;
      if (patch.y !== undefined) live.y = patch.y;
      if (patch.scale !== undefined) live.scale = patch.scale;
      if (patch.opacity !== undefined) live.opacity = patch.opacity;
      if (Object.keys(live).length) setLogo(prev => (prev ? { ...prev, ...live } : prev));
    }
  }, []);

  const removeControlRoomSource = useCallback((id: string) => {
    if (id === activeControlRoomIdRef.current) takeControlRoomOffAir();
    setControlRoomSources(prev => {
      const s = prev.find(x => x.id === id);
      if (s) { URL.revokeObjectURL(s.url); void deleteControlRoomBlob(s.assetId); }
      return prev.filter(x => x.id !== id);
    });
  }, [takeControlRoomOffAir]);

  // Metadata captured at mount so the first persist() can't clobber the saved
  // list before the async blob hydration runs (mirrors the music bed).
  const controlRoomSaved = useRef<SavedControlRoomSource[] | null>(null);
  if (controlRoomSaved.current === null) controlRoomSaved.current = loadControlRoomSources();

  // Rehydrate the saved bank once on mount: rebuild each source's File + preview
  // URL from its persisted blob, dropping any whose blob was evicted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = controlRoomSaved.current ?? [];
      if (!saved.length) return;
      const hydrated: ControlRoomSource[] = [];
      for (const s of saved) {
        const blob = await getControlRoomBlob(s.assetId);
        if (!blob) continue;
        const file = new File([blob], s.fileName || 'graphic', { type: s.fileType || blob.type });
        hydrated.push({
          id: s.id, file, url: URL.createObjectURL(file), kind: s.kind,
          libraryId: s.libraryId, assetId: s.assetId, name: s.name,
          color: s.color, alpha: s.alpha, x: s.x, y: s.y, scale: s.scale, opacity: s.opacity,
        });
      }
      if (!cancelled && hydrated.length) setControlRoomSources(hydrated);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist the bank (metadata only — blobs live in IndexedDB) so the next
  // session restores the same sources and their settings.
  useEffect(() => {
    try {
      localStorage.setItem(CONTROL_ROOM_KEY, JSON.stringify(
        controlRoomSources.map((s): SavedControlRoomSource => ({
          id: s.id, kind: s.kind, libraryId: s.libraryId, assetId: s.assetId,
          name: s.name, color: s.color, alpha: s.alpha,
          fileName: s.file.name, fileType: s.file.type,
          x: s.x, y: s.y, scale: s.scale, opacity: s.opacity,
        })),
      ));
    } catch { /* storage unavailable — persistence is best-effort */ }
  }, [controlRoomSources]);

  // Revoke preview URLs on unmount (blobs persist in IndexedDB).
  useEffect(() => () => {
    setControlRoomSources(prev => { prev.forEach(s => URL.revokeObjectURL(s.url)); return prev; });
  }, []);

  // ── Control Room Sound Fx (cue buttons) ──────────────────────────────────
  // Mirrors the graphic bank for persistence, and the music bed for audio:
  // a single shared <audio> element fires the cue; its captureStream is fed
  // into the broadcast mix so the stream (and the host's monitor) hear it.
  const [controlRoomSounds, setControlRoomSounds] = useState<ControlRoomSound[]>([]);
  const controlRoomSoundsRef = useRef<ControlRoomSound[]>([]);
  useEffect(() => { controlRoomSoundsRef.current = controlRoomSounds; }, [controlRoomSounds]);
  const [playingControlRoomSoundId, setPlayingControlRoomSoundId] = useState<string | null>(null);
  const playingSfxIdRef = useRef<string | null>(null);
  useEffect(() => { playingSfxIdRef.current = playingControlRoomSoundId; }, [playingControlRoomSoundId]);
  const [sfxStream, setSfxStream] = useState<MediaStream | null>(null);
  const sfxAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopControlRoomSound = useCallback(() => {
    const el = sfxAudioRef.current;
    if (el) { el.pause(); el.currentTime = 0; }
    setPlayingControlRoomSoundId(null);
  }, []);

  const playControlRoomSound = useCallback((id: string) => {
    const snd = controlRoomSoundsRef.current.find(s => s.id === id);
    if (!snd) return;
    let el = sfxAudioRef.current;
    if (!el) { el = new Audio(); el.preload = 'auto'; sfxAudioRef.current = el; }
    // Re-firing the cue that's already playing toggles it off.
    if (playingSfxIdRef.current === id && !el.paused) { stopControlRoomSound(); return; }
    el.onended = () => setPlayingControlRoomSoundId(null);
    el.src = snd.url;
    el.currentTime = 0;
    el.muted = false; // the host hears their own cue (headphones recommended)
    void el.play().then(() => {
      if (!sfxStream) {
        const s = (el as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.();
        if (s) setSfxStream(s);
      }
    }).catch(() => setPlayingControlRoomSoundId(null));
    setPlayingControlRoomSoundId(id);
  }, [sfxStream, stopControlRoomSound]);

  // Persist the cue list (id + assetId + name) per user, debounced so rapid
  // renames don't hammer the network. Blobs already live in the cloud bucket.
  const sfxPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistControlRoomSounds = useCallback((list: ControlRoomSound[]) => {
    const meta: SavedControlRoomSound[] = list.map(s => ({ id: s.id, assetId: s.assetId, name: s.name }));
    if (sfxPersistTimer.current) clearTimeout(sfxPersistTimer.current);
    sfxPersistTimer.current = setTimeout(() => { void putMeta(CONTROL_ROOM_SFX_META_KEY, meta); }, 400);
  }, []);

  const addControlRoomSound = useCallback(async (input: { file: File; name?: string }) => {
    if (controlRoomSoundsRef.current.length >= CONTROL_ROOM_SFX_MAX) return false;
    // Upload the audio to the user's cloud bucket first so the persisted cue
    // list only ever references a blob that actually exists.
    let assetId: string;
    try {
      assetId = await putAsset(input.file);
    } catch {
      return false; // not signed in / upload failed
    }
    const snd: ControlRoomSound = {
      id: crypto.randomUUID(),
      url: URL.createObjectURL(input.file),
      assetId,
      name: input.name?.trim() || `Sound ${controlRoomSoundsRef.current.length + 1}`,
    };
    controlRoomSoundsRef.current = [...controlRoomSoundsRef.current, snd];
    setControlRoomSounds(controlRoomSoundsRef.current);
    persistControlRoomSounds(controlRoomSoundsRef.current);
    return true;
  }, [persistControlRoomSounds]);

  const updateControlRoomSound = useCallback((id: string, patch: { name: string }) => {
    controlRoomSoundsRef.current = controlRoomSoundsRef.current.map(s => (s.id === id ? { ...s, name: patch.name } : s));
    setControlRoomSounds(controlRoomSoundsRef.current);
    persistControlRoomSounds(controlRoomSoundsRef.current);
  }, [persistControlRoomSounds]);

  const removeControlRoomSound = useCallback((id: string) => {
    if (playingSfxIdRef.current === id) stopControlRoomSound();
    const snd = controlRoomSoundsRef.current.find(s => s.id === id);
    if (snd) {
      if (snd.url.startsWith('blob:')) URL.revokeObjectURL(snd.url);
      void deleteAsset(snd.assetId); // remove the blob from the user's cloud bucket
    }
    controlRoomSoundsRef.current = controlRoomSoundsRef.current.filter(s => s.id !== id);
    setControlRoomSounds(controlRoomSoundsRef.current);
    persistControlRoomSounds(controlRoomSoundsRef.current);
  }, [stopControlRoomSound, persistControlRoomSounds]);

  // Rehydrate the user's cues once on mount from the cloud: read the saved list,
  // then fetch each blob into a local object URL (instant, expiry-proof firing).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getMeta<SavedControlRoomSound[]>(CONTROL_ROOM_SFX_META_KEY);
      if (cancelled || !saved?.length) return;
      const hydrated: ControlRoomSound[] = [];
      for (const s of saved) {
        const signed = await getAssetUrl(s.assetId);
        if (!signed) continue; // blob evicted / unreachable — drop the cue
        try {
          const blob = await (await fetch(signed)).blob();
          hydrated.push({ id: s.id, url: URL.createObjectURL(blob), assetId: s.assetId, name: s.name });
        } catch { /* skip this cue */ }
      }
      if (!cancelled && hydrated.length) {
        controlRoomSoundsRef.current = hydrated;
        setControlRoomSounds(hydrated);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    sfxAudioRef.current?.pause();
    setControlRoomSounds(prev => { prev.forEach(s => { if (s.url.startsWith('blob:')) URL.revokeObjectURL(s.url); }); return prev; });
  }, []);

  // Persist the motion logo's placement as it changes; restore it on boot.
  useEffect(() => {
    const assetId = motionLogoAssetId.current;
    if (!assetId) return;
    try {
      if (logo && logo.kind === 'video') {
        localStorage.setItem(MOTION_LOGO_KEY, JSON.stringify({
          assetId, x: logo.x, y: logo.y, scale: logo.scale, opacity: logo.opacity, visible: logo.visible,
        }));
      }
    } catch { /* storage unavailable — persistence is best-effort */ }
  }, [logo]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let saved: { assetId: string; x: number; y: number; scale: number; opacity: number; visible: boolean };
      try {
        const raw = localStorage.getItem(MOTION_LOGO_KEY);
        if (!raw) return;
        saved = JSON.parse(raw);
        if (!saved?.assetId) return;
      } catch { return; }
      try {
        // Re-fetch the saved render as a blob (an untainted same-session URL).
        const remote = await getAssetUrl(saved.assetId);
        if (!remote || cancelled) return;
        const res = await fetch(remote);
        if (!res.ok || cancelled) return;
        const url = URL.createObjectURL(await res.blob());
        if (cancelled) { URL.revokeObjectURL(url); return; }
        motionLogoAssetId.current = saved.assetId;
        setLogo({
          url, kind: 'video',
          x: saved.x ?? 0.5, y: saved.y ?? 0.5, scale: saved.scale ?? 0.5,
          opacity: saved.opacity ?? 100, visible: saved.visible ?? true,
        });
      } catch { /* asset gone or signed out — leave the logo unset */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // Lower-thirds deck: several saved graphics, at most one cued on air.
  // The deck persists across sessions (localStorage); the cued state
  // deliberately does not — nothing should be on air right after login.
  const [lowerThirds, setLowerThirds] = useState<LowerThirdItem[]>(() =>
    loadSavedLowerThirds() ?? [
      { id: crypto.randomUUID(), title: '', subtitle: '', style: DEFAULT_LOWER_THIRD_STYLE },
    ],
  );
  const [activeLowerThirdId, setActiveLowerThirdId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LOWER_THIRDS_KEY, JSON.stringify(lowerThirds));
    } catch { /* storage unavailable — persistence is best-effort */ }
  }, [lowerThirds]);

  const addLowerThird = useCallback((): string => {
    const id = crypto.randomUUID();
    setLowerThirds(prev => [...prev, { id, title: '', subtitle: '', style: DEFAULT_LOWER_THIRD_STYLE }]);
    return id;
  }, []);

  const removeLowerThird = useCallback((id: string) => {
    setLowerThirds(prev => prev.filter(l => l.id !== id));
    setActiveLowerThirdId(prev => (prev === id ? null : prev));
  }, []);

  const updateLowerThirdItem = useCallback((id: string, patch: Partial<Omit<LowerThirdItem, 'id'>>) => {
    setLowerThirds(prev => prev.map(l =>
      l.id === id ? { ...l, ...patch, style: patch.style ? { ...l.style, ...patch.style } : l.style } : l,
    ));
  }, []);

  const cueLowerThird = useCallback((id: string | null) => {
    setActiveLowerThirdId(id);
  }, []);

  // Derived render state consumed by the compositor and previews
  const activeLowerThirdItem = lowerThirds.find(l => l.id === activeLowerThirdId) ?? null;
  const lowerThird: LowerThird = activeLowerThirdItem
    ? { title: activeLowerThirdItem.title, subtitle: activeLowerThirdItem.subtitle, visible: true, style: activeLowerThirdItem.style }
    : { title: '', subtitle: '', visible: false, style: DEFAULT_LOWER_THIRD_STYLE };

  // The lower third being edited in the panel — shown as a temporary (non-
  // broadcast) placeholder on the preview so its placement can be seen before
  // it's cued. Cueing (activeLowerThirdId) is what actually goes to air.
  const [previewLowerThirdId, setPreviewLowerThirdId] = useState<string | null>(null);
  const previewLowerThirdItem = lowerThirds.find(l => l.id === previewLowerThirdId) ?? null;
  const previewLowerThird: LowerThird = previewLowerThirdItem
    ? { title: previewLowerThirdItem.title, subtitle: previewLowerThirdItem.subtitle, visible: !!previewLowerThirdItem.title, style: previewLowerThirdItem.style }
    : { title: '', subtitle: '', visible: false, style: DEFAULT_LOWER_THIRD_STYLE };
  const [captureQuality, setCaptureQualityState] = useState<CaptureQuality>(() =>
    (localStorage.getItem('studio-capture-quality') as CaptureQuality) || '1080p',
  );
  // Self-view mirror — a preview-only convenience so the host isn't disoriented
  // by an un-flipped image. Persisted; never applied to the outgoing feed.
  const [mirrorPreview, setMirrorPreviewState] = useState<boolean>(
    () => localStorage.getItem('studio-mirror-preview') === '1',
  );
  const setMirrorPreview = useCallback((v: boolean) => {
    setMirrorPreviewState(v);
    localStorage.setItem('studio-mirror-preview', v ? '1' : '0');
  }, []);
  const [orientation, setOrientationState] = useState<StreamOrientation>(() =>
    (localStorage.getItem('studio-orientation') as StreamOrientation) || 'landscape',
  );

  // ── Camera hardware selection ──
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(() =>
    localStorage.getItem('studio-camera-id'),
  );
  const [camera2Stream, setCamera2Stream] = useState<MediaStream | null>(null);
  const [isCamera2On, setIsCamera2On] = useState(false);
  const [selectedCamera2Id, setSelectedCamera2Id] = useState<string | null>(null);

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  // Primary microphone device (captured together with the program camera)
  const [selectedMicId, setSelectedMicId] = useState<string | null>(() =>
    localStorage.getItem('studio-mic-id'),
  );

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(list.filter(d => d.kind === 'videoinput'));
      setAudioDevices(list.filter(d => d.kind === 'audioinput'));
    } catch { /* enumeration unavailable */ }
  }, []);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  // Clean re-detection, as if the studio had just been opened: release every
  // camera, probe fresh (forces the browser to surface new devices + labels),
  // re-enumerate, invalidate vanished selections, restore active captures.
  const hardRefreshDevices = useCallback(async () => {
    const cameraWasOn = !!cameraStream;
    const camera2WasOn = !!camera2Stream;
    const micWasOn = isMicOn;

    cameraStream?.getTracks().forEach(t => t.stop());
    camera2Stream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setIsCameraOn(false);
    setIsMicOn(false);
    setCamera2Stream(null);
    setIsCamera2On(false);

    // Throwaway probe: releases + reacquires permission state so the device
    // list is rebuilt exactly like a first visit
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      probe.getTracks().forEach(t => t.stop());
    } catch { /* no permission / no camera — enumerate anyway */ }

    let videos: MediaDeviceInfo[] = [];
    let audios: MediaDeviceInfo[] = [];
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      videos = list.filter(d => d.kind === 'videoinput');
      audios = list.filter(d => d.kind === 'audioinput');
    } catch { /* enumeration unavailable */ }
    setVideoDevices(videos);
    setAudioDevices(audios);

    // Drop selections pointing at devices that no longer exist
    const camValid = !!selectedCameraId && videos.some(d => d.deviceId === selectedCameraId);
    const cam2Valid = !!selectedCamera2Id && videos.some(d => d.deviceId === selectedCamera2Id);
    const micValid = !!selectedMicId && audios.some(d => d.deviceId === selectedMicId);
    const nextCamId = camValid ? selectedCameraId : null;
    const nextMicId = micValid ? selectedMicId : null;
    if (!camValid) {
      setSelectedCameraId(null);
      localStorage.removeItem('studio-camera-id');
    }
    if (!cam2Valid) setSelectedCamera2Id(null);
    if (!micValid) {
      setSelectedMicId(null);
      localStorage.removeItem('studio-mic-id');
    }

    // Restore what was running
    if (cameraWasOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          cameraConstraints(captureQuality, nextCamId ?? undefined, true, nextMicId, orientation),
        );
        stream.getAudioTracks().forEach(t => { t.enabled = micWasOn; });
        setCameraStream(stream);
        setIsCameraOn(true);
        setIsMicOn(micWasOn);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Camera restore failed:', err);
      }
    }
    if (camera2WasOn && cam2Valid) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          cameraConstraints(captureQuality, selectedCamera2Id!, false, null, orientation),
        );
        setCamera2Stream(stream);
        setIsCamera2On(true);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Camera 2 restore failed:', err);
      }
    }
  }, [cameraStream, camera2Stream, isMicOn, selectedCameraId, selectedCamera2Id, selectedMicId, captureQuality, orientation]);

  // Default the primary camera to the built-in FaceTime HD Camera when the
  // user hasn't chosen one — freely replaceable at any time. (Labels are
  // only known once camera permission has been granted.)
  useEffect(() => {
    if (selectedCameraId || videoDevices.length === 0) return;
    const labeled = videoDevices.filter(d => d.label);
    if (!labeled.length) return;
    const preferred = labeled.find(d => /facetime/i.test(d.label)) ?? labeled[0];
    setSelectedCameraId(preferred.deviceId);
  }, [videoDevices, selectedCameraId]);

  // A camera that is also a mic (webcam, Mevo, capture card…) exposes its
  // audio input under the same groupId — prefer capturing its own sound so
  // the primary mic always matches the program camera's hardware
  const micMatchingCamera = useCallback((cameraDeviceId?: string | null): string | null => {
    if (!cameraDeviceId) return null;
    const cam = videoDevices.find(d => d.deviceId === cameraDeviceId);
    if (!cam) return null;
    const match = audioDevices.find(a => a.groupId && a.groupId === cam.groupId)
      ?? audioDevices.find(a => a.label && cam.label && a.label === cam.label);
    return match?.deviceId ?? null;
  }, [videoDevices, audioDevices]);

  // Default the primary microphone the same way as the camera when the user
  // hasn't chosen one, so AV Settings → Audio shows their default mic on login
  // instead of an empty picker. Prefer the OS default input, then a mic on the
  // program camera's own hardware, then the first available. (Labels/ids are
  // only known once mic permission has been granted — a successful camera
  // auto-start grants it, then re-enumerates.)
  useEffect(() => {
    if (selectedMicId || audioDevices.length === 0) return;
    const preferred = pickDefaultDevice(audioDevices, ['default', micMatchingCamera(selectedCameraId)]);
    if (preferred) setSelectedMicId(preferred);
  }, [audioDevices, selectedMicId, selectedCameraId, micMatchingCamera]);

  // Capture the program feed, degrading gracefully instead of failing
  // silently: requested camera + its own mic (or the selected one) → any mic
  // (saved id stale) → no mic (permission blocked / no device) → default
  // camera. Returns null only when no video could be captured at all.
  const acquireProgramStream = useCallback(async (
    deviceId?: string | null,
  ): Promise<{ stream: MediaStream; hasAudio: boolean } | null> => {
    const preferredMicId = micMatchingCamera(deviceId) ?? selectedMicId;
    const attempts: { constraints: MediaStreamConstraints; hasAudio: boolean }[] = [
      { constraints: cameraConstraints(captureQuality, deviceId ?? undefined, true, preferredMicId, orientation), hasAudio: true },
      { constraints: cameraConstraints(captureQuality, deviceId ?? undefined, true, null, orientation), hasAudio: true },
      { constraints: cameraConstraints(captureQuality, deviceId ?? undefined, false, null, orientation), hasAudio: false },
      { constraints: cameraConstraints(captureQuality, undefined, true, null, orientation), hasAudio: true },
      { constraints: cameraConstraints(captureQuality, undefined, false, null, orientation), hasAudio: false },
    ];
    let lastErr: unknown;
    for (const attempt of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
        if (!attempt.hasAudio) {
          notify({
            title: 'Camera started without microphone',
            description: 'The mic could not be captured — check the browser mic permission or pick a mic under AV Settings → Audio.',
          });
        }
        return { stream, hasAudio: attempt.hasAudio };
      } catch (err) {
        lastErr = err;
      }
    }
    console.error('Camera capture failed:', lastErr);
    notify({
      title: 'Camera unavailable',
      description: lastErr instanceof Error ? `${lastErr.name}: ${lastErr.message}` : 'Could not access any camera',
      variant: 'destructive',
    });
    return null;
  }, [captureQuality, selectedMicId, orientation, micMatchingCamera]);

  // Put an acquired stream on program: sync the selections to the devices
  // that actually opened (a fallback may differ from the request, and the
  // Audio tab's primary mic must mirror what the program feed captures)
  const adoptProgramStream = useCallback((stream: MediaStream, hasAudio: boolean, micEnabled = true) => {
    const actualId = stream.getVideoTracks()[0]?.getSettings().deviceId;
    if (actualId) {
      setSelectedCameraId(actualId);
      localStorage.setItem('studio-camera-id', actualId);
    }
    const actualMicId = stream.getAudioTracks()[0]?.getSettings().deviceId;
    if (actualMicId) {
      setSelectedMicId(actualMicId);
      localStorage.setItem('studio-mic-id', actualMicId);
      window.dispatchEvent(new Event(MIC_CHANGED_EVENT));
    }
    stream.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
    setCameraStream(stream);
    setIsCameraOn(true);
    setIsMicOn(hasAudio && micEnabled);
    refreshDevices(); // device labels populate once permission is granted
  }, [refreshDevices]);

  const toggleCamera = useCallback(async () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
      setIsCameraOn(false);
      setIsMicOn(false);
    } else {
      const acquired = await acquireProgramStream(selectedCameraId);
      if (acquired) adoptProgramStream(acquired.stream, acquired.hasAudio);
    }
  }, [cameraStream, selectedCameraId, acquireProgramStream, adoptProgramStream]);

  // Open camera + mic as soon as the studio loads (post-login) so the user
  // lands with both sources live instead of a blank preview
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    (async () => {
      const acquired = await acquireProgramStream(selectedCameraId);
      if (acquired) adoptProgramStream(acquired.stream, acquired.hasAudio);
    })();
    // Run once on mount with whatever devices were restored from storage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Choose the primary microphone; restarts the camera capture if running
  const selectMic = useCallback(async (deviceId: string) => {
    setSelectedMicId(deviceId);
    localStorage.setItem('studio-mic-id', deviceId);
    // Let the teleprompter's voice engine follow the new mic live.
    window.dispatchEvent(new Event(MIC_CHANGED_EVENT));
    if (!cameraStream) return;
    cameraStream.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        cameraConstraints(captureQuality, selectedCameraId ?? undefined, true, deviceId, orientation),
      );
      stream.getAudioTracks().forEach(t => { t.enabled = isMicOn; });
      setCameraStream(stream);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Mic switch failed:', err);
      setCameraStream(null);
      setIsCameraOn(false);
      setIsMicOn(false);
    }
  }, [cameraStream, captureQuality, selectedCameraId, isMicOn, orientation]);

  // Switch primary camera hardware; restarts the stream if it's running
  const selectCamera = useCallback(async (deviceId: string) => {
    setSelectedCameraId(deviceId);
    localStorage.setItem('studio-camera-id', deviceId);
    if (!cameraStream) return;
    cameraStream.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        cameraConstraints(captureQuality, deviceId, true, selectedMicId, orientation),
      );
      stream.getAudioTracks().forEach(t => { t.enabled = isMicOn; });
      setCameraStream(stream);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Camera switch failed:', err);
      setCameraStream(null);
      setIsCameraOn(false);
      setIsMicOn(false);
    }
  }, [cameraStream, captureQuality, isMicOn, selectedMicId, orientation]);

  // Cut the program camera to a specific device — starts the camera if it
  // was off, otherwise hot-switches hardware.
  const switchCamera = useCallback(async (deviceId: string) => {
    const wasOn = !!cameraStream;
    setSelectedCameraId(deviceId);
    localStorage.setItem('studio-camera-id', deviceId);
    cameraStream?.getTracks().forEach(t => t.stop());
    const acquired = await acquireProgramStream(deviceId);
    if (!acquired) {
      setCameraStream(null);
      setIsCameraOn(false);
      setIsMicOn(false);
      return;
    }
    // Preserve mute state across a switch; fresh starts default unmuted
    adoptProgramStream(acquired.stream, acquired.hasAudio, wasOn ? isMicOn : true);
  }, [cameraStream, isMicOn, acquireProgramStream, adoptProgramStream]);

  // Set (or clear) the picture-in-picture camera by device
  const setPipCamera = useCallback(async (deviceId: string | null) => {
    camera2Stream?.getTracks().forEach(t => t.stop());
    if (!deviceId) {
      setCamera2Stream(null);
      setIsCamera2On(false);
      setSelectedCamera2Id(null);
      return;
    }
    setSelectedCamera2Id(deviceId);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        cameraConstraints(captureQuality, deviceId, false, null, orientation),
      );
      setCamera2Stream(stream);
      setIsCamera2On(true);
    } catch (err) {
      if (import.meta.env.DEV) console.error('PiP camera failed:', err);
      setCamera2Stream(null);
      setIsCamera2On(false);
    }
  }, [camera2Stream, captureQuality, orientation]);

  // ── Additional microphone sources ──
  const [extraMics, setExtraMics] = useState<ExtraMic[]>([]);

  const addExtraMic = useCallback(() => {
    setExtraMics(prev => prev.length >= MAX_EXTRA_MICS
      ? prev
      : [...prev, { id: crypto.randomUUID(), deviceId: null, volume: 100, stream: null }]);
  }, []);

  const removeExtraMic = useCallback((id: string) => {
    setExtraMics(prev => {
      prev.find(m => m.id === id)?.stream?.getTracks().forEach(t => t.stop());
      return prev.filter(m => m.id !== id);
    });
  }, []);

  const setExtraMicVolume = useCallback((id: string, volume: number) => {
    setExtraMics(prev => prev.map(m => m.id === id ? { ...m, volume } : m));
  }, []);

  const captureMic = useCallback(async (deviceId: string): Promise<MediaStream> => {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }, []);

  const setExtraMicDevice = useCallback(async (id: string, deviceId: string) => {
    const mic = extraMics.find(m => m.id === id);
    if (!mic) return;
    mic.stream?.getTracks().forEach(t => t.stop());
    let stream: MediaStream | null = null;
    if (mic.stream) {
      // Was capturing — follow the hardware change
      try { stream = await captureMic(deviceId); } catch { /* device refused */ }
    }
    setExtraMics(prev => prev.map(m => m.id === id ? { ...m, deviceId, stream } : m));
  }, [extraMics, captureMic]);

  const toggleExtraMic = useCallback(async (id: string) => {
    const mic = extraMics.find(m => m.id === id);
    if (!mic?.deviceId) return;
    if (mic.stream) {
      mic.stream.getTracks().forEach(t => t.stop());
      setExtraMics(prev => prev.map(m => m.id === id ? { ...m, stream: null } : m));
      return;
    }
    try {
      const stream = await captureMic(mic.deviceId);
      setExtraMics(prev => prev.map(m => m.id === id ? { ...m, stream } : m));
      refreshDevices();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Extra mic failed:', err);
    }
  }, [extraMics, captureMic, refreshDevices]);

  // ── Music bed ──
  // Play uploaded/Suno tracks through a hidden <audio> element and mix its
  // output into the broadcast via the compositor's extra-audio path (its own
  // gain). The element is muted unless "monitor" is on — like media playback,
  // captureStream still carries the audio to the broadcast when muted, so the
  // host doesn't get speaker echo into their mic.
  // Persisted so a returning user keeps their bed and levels (see effects below).
  const musicSaved = loadMusicSettings();
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [musicPlayingId, setMusicPlayingId] = useState<string | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolumeState] = useState(musicSaved.volume);
  const [musicLoop, setMusicLoop] = useState(musicSaved.loop);
  const [musicMonitor, setMusicMonitor] = useState(musicSaved.monitor);
  const [musicStream, setMusicStream] = useState<MediaStream | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  // Track metadata captured at mount so a first persist() can't clobber it
  // before the async blob hydration runs.
  const musicSavedTracks = useRef<SavedMusicTrack[] | null>(null);
  if (musicSavedTracks.current === null) musicSavedTracks.current = loadMusicTrackList();
  // Latest values for the stable 'ended' handler (avoids stale closures).
  const musicNav = useRef({ tracks: musicTracks, playingId: musicPlayingId, loop: musicLoop });
  musicNav.current = { tracks: musicTracks, playingId: musicPlayingId, loop: musicLoop };

  const playMusicTrack = useCallback((id: string) => {
    const track = musicNav.current.tracks.find(t => t.id === id);
    if (!track) return;
    let el = musicAudioRef.current;
    if (!el) {
      el = new Audio();
      el.preload = 'auto';
      musicAudioRef.current = el;
    }
    // (Re)bind the end handler so loop / next-track uses the latest state.
    el.onended = () => {
      const { tracks, playingId, loop } = musicNav.current;
      if (loop) { el!.currentTime = 0; void el!.play(); return; }
      const idx = tracks.findIndex(t => t.id === playingId);
      const next = idx >= 0 ? tracks[idx + 1] : undefined;
      if (next) { playMusicTrack(next.id); } else { setMusicPlaying(false); setMusicPlayingId(null); }
    };
    el.src = track.url;
    el.loop = false; // looping handled in onended so playlists can advance
    el.muted = !musicMonitor;
    el.volume = musicVolume / 100;
    void el.play().then(() => {
      if (!musicStream) {
        const s = (el as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.();
        if (s) setMusicStream(s);
      }
    }).catch(() => { /* autoplay/user-gesture — retried on next explicit play */ });
    setMusicPlayingId(id);
    setMusicPlaying(true);
  }, [musicMonitor, musicVolume, musicStream]);

  const toggleMusicPlayback = useCallback(() => {
    const el = musicAudioRef.current;
    if (!el || !musicPlayingId) {
      if (musicTracks[0]) playMusicTrack(musicTracks[0].id);
      return;
    }
    if (el.paused) { void el.play(); setMusicPlaying(true); }
    else { el.pause(); setMusicPlaying(false); }
  }, [musicPlayingId, musicTracks, playMusicTrack]);

  const stopMusic = useCallback(() => {
    const el = musicAudioRef.current;
    if (el) { el.pause(); el.currentTime = 0; }
    setMusicPlaying(false);
    setMusicPlayingId(null);
  }, []);

  const addMusicFile = useCallback(async (file: File, name?: string, source: 'upload' | 'suno' = 'upload') => {
    const assetId = await putMusicBlob(file);
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    const clean = (name ?? file.name).replace(/\.[^/.]+$/, '').slice(0, 80) || 'Track';
    setMusicTracks(prev => [...prev, { id, name: clean, url, source, assetId }]);
    return id;
  }, []);

  const removeMusicTrack = useCallback((id: string) => {
    setMusicTracks(prev => {
      const t = prev.find(x => x.id === id);
      if (t) { URL.revokeObjectURL(t.url); void deleteMusicBlob(t.assetId); }
      return prev.filter(x => x.id !== id);
    });
    setMusicPlayingId(cur => {
      if (cur !== id) return cur;
      const el = musicAudioRef.current;
      if (el) { el.pause(); el.currentTime = 0; }
      setMusicPlaying(false);
      return null;
    });
  }, []);

  const setMusicVolume = useCallback((v: number) => {
    setMusicVolumeState(v);
    if (musicAudioRef.current) musicAudioRef.current.volume = v / 100;
  }, []);

  const toggleMusicLoop = useCallback(() => setMusicLoop(v => !v), []);

  const toggleMusicMonitor = useCallback(() => {
    setMusicMonitor(v => {
      const next = !v;
      if (musicAudioRef.current) musicAudioRef.current.muted = !next;
      return next;
    });
  }, []);

  // Release the audio element and any object URLs on unmount (blobs persist).
  useEffect(() => () => {
    musicAudioRef.current?.pause();
    setMusicTracks(prev => { prev.forEach(t => URL.revokeObjectURL(t.url)); return prev; });
  }, []);

  // Rehydrate the saved bed once on mount: rebuild playable URLs from the
  // persisted blobs, dropping any whose blob was evicted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = musicSavedTracks.current ?? [];
      if (!saved.length) return;
      const hydrated: MusicTrack[] = [];
      for (const s of saved) {
        const url = await getMusicBlobUrl(s.assetId);
        if (url) hydrated.push({ id: s.id, name: s.name, url, source: s.source, assetId: s.assetId });
      }
      if (!cancelled && hydrated.length) setMusicTracks(hydrated);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist the track list (metadata only — blobs live in IndexedDB) and the
  // playback settings so the next session restores the same setup.
  useEffect(() => {
    try {
      localStorage.setItem(MUSIC_TRACKS_KEY, JSON.stringify(
        musicTracks.map(t => ({ id: t.id, name: t.name, source: t.source, assetId: t.assetId })),
      ));
    } catch { /* storage unavailable — persistence is best-effort */ }
  }, [musicTracks]);

  useEffect(() => {
    try {
      localStorage.setItem(MUSIC_SETTINGS_KEY,
        JSON.stringify({ volume: musicVolume, loop: musicLoop, monitor: musicMonitor }));
    } catch { /* best-effort */ }
  }, [musicVolume, musicLoop, musicMonitor]);

  // Second camera: video-only (no second mic — avoids duplicate/echoing audio)
  const toggleCamera2 = useCallback(async () => {
    if (camera2Stream) {
      camera2Stream.getTracks().forEach(t => t.stop());
      setCamera2Stream(null);
      setIsCamera2On(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          cameraConstraints(captureQuality, selectedCamera2Id ?? undefined, false, null, orientation),
        );
        setCamera2Stream(stream);
        setIsCamera2On(true);
        refreshDevices();
      } catch (err) {
        if (import.meta.env.DEV) console.error('Second camera access failed:', err);
      }
    }
  }, [camera2Stream, captureQuality, selectedCamera2Id, orientation, refreshDevices]);

  // Changing quality while the camera runs restarts it with new constraints
  const setCaptureQuality = useCallback(async (quality: CaptureQuality) => {
    setCaptureQualityState(quality);
    localStorage.setItem('studio-capture-quality', quality);
    if (!cameraStream) return;
    cameraStream.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        cameraConstraints(quality, selectedCameraId ?? undefined, true, selectedMicId, orientation),
      );
      stream.getAudioTracks().forEach(t => { t.enabled = isMicOn; });
      setCameraStream(stream);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Camera restart failed:', err);
      setCameraStream(null);
      setIsCameraOn(false);
      setIsMicOn(false);
    }
  }, [cameraStream, isMicOn, selectedCameraId, selectedMicId, orientation]);

  // Switch broadcast orientation (16:9 vs 9:16); restarts the camera with
  // swapped capture constraints. Takes effect on the next broadcast's canvas.
  const setOrientation = useCallback(async (o: StreamOrientation) => {
    setOrientationState(o);
    localStorage.setItem('studio-orientation', o);
    if (!cameraStream) return;
    cameraStream.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        cameraConstraints(captureQuality, selectedCameraId ?? undefined, true, selectedMicId, o),
      );
      stream.getAudioTracks().forEach(t => { t.enabled = isMicOn; });
      setCameraStream(stream);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Orientation switch failed:', err);
      setCameraStream(null);
      setIsCameraOn(false);
      setIsMicOn(false);
    }
  }, [cameraStream, captureQuality, selectedCameraId, selectedMicId, isMicOn]);

  const toggleMic = useCallback(() => {
    if (cameraStream) {
      const audioTracks = cameraStream.getAudioTracks();
      const newEnabled = !isMicOn;
      audioTracks.forEach(t => { t.enabled = newEnabled; });
      setIsMicOn(newEnabled);
    }
  }, [cameraStream, isMicOn]);

  // Slideshow presentation. Shares the screen-share slot (one presentation at
  // a time): a loaded deck becomes screenStream so it flows through the whole
  // pipeline unchanged.
  const slideshowRef = useRef<SlideshowController | null>(null);
  const [slideshow, setSlideshow] = useState<SlideshowMeta | null>(null);
  // Last slide shown per deck (keyed by title), so stopping and re-presenting
  // the same deck resumes where it left off instead of jumping back to slide 1.
  const slideResumeRef = useRef<Map<string, number>>(new Map());

  const closeSlideshow = useCallback(() => {
    const ctrl = slideshowRef.current;
    if (ctrl) slideResumeRef.current.set(ctrl.title, ctrl.meta.current);
    ctrl?.dispose();
    slideshowRef.current = null;
    setSlideshow(null);
    setScreenStream(null);
    setIsScreenSharing(false);
  }, []);

  const toggleScreenShare = useCallback(async () => {
    // Presenting slides? The Share Screen button ends the presentation.
    if (slideshowRef.current) {
      closeSlideshow();
      return;
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
    } else {
      try {
        const preset = QUALITY_PRESETS[captureQuality];
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: 30 },
          },
        });
        setScreenStream(stream);
        setIsScreenSharing(true);
        stream.getVideoTracks()[0].onended = () => {
          setScreenStream(null);
          setIsScreenSharing(false);
        };
      } catch (err) {
        if (import.meta.env.DEV) console.error('Screen share failed:', err);
      }
    }
  }, [screenStream, captureQuality, closeSlideshow]);

  const loadSlideshow = useCallback(async (file: File): Promise<string | null> => {
    try {
      // A slideshow and a real screen share can't both hold the slot. Remember
      // where the outgoing deck was so switching decks keeps each one's place.
      const prev = slideshowRef.current;
      if (prev) slideResumeRef.current.set(prev.title, prev.meta.current);
      prev?.dispose();
      slideshowRef.current = null;
      setScreenStream(prevStream => {
        prevStream?.getTracks().forEach(t => t.stop());
        return null;
      });
      const startPage = slideResumeRef.current.get(deckTitleFromName(file.name)) ?? 1;
      const ctrl = await SlideshowController.load(file, meta => setSlideshow(meta), startPage);
      slideshowRef.current = ctrl;
      setSlideshow(ctrl.meta);
      setScreenStream(ctrl.stream);
      setIsScreenSharing(true);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not open the slideshow';
    }
  }, []);

  const slideNext = useCallback(() => slideshowRef.current?.next(), []);
  const slidePrev = useCallback(() => slideshowRef.current?.prev(), []);
  const slideGoTo = useCallback((n: number) => slideshowRef.current?.goTo(n), []);


  const { toast } = useToast();
  const sessionIdRef = useRef<string | null>(null);

  // Broadcast compositor: renders sources + filter + overlays to a canvas and
  // mixes audio, producing the stream Daily actually publishes. Created on
  // goLive, torn down on stopLive/failure. Inputs are mirrored into a ref so
  // goLive doesn't need every piece of scene state in its dependency list.
  const compositorRef = useRef<StreamCompositor | null>(null);
  const compositorInputsRef = useRef<CompositorInputs>({
    cameraStream: null,
    screenStream: null,
    camera2Stream: null,
    mediaStream: null,
    mediaHideCamera: false,
    isCameraOn: false,
    isCamera2On: false,
    isScreenSharing: false,
    filter: 'none',
    grade: NEUTRAL_GRADE,
    lut: null,
    logo: null,
    extraAudio: [],
    lowerThird: { title: '', subtitle: '', visible: false, style: DEFAULT_LOWER_THIRD_STYLE },
    activePoll: null,
    highlightedQuestion: null,
    volume: 75,
    eq: EQ_NEUTRAL,
    audioEffects: AUDIO_EFFECTS_NEUTRAL,
    pipPosition: PIP_DEFAULT_POSITION,
    guests: [],
    guestLayout: 'split',
    program: 'auto',
    featuredGuestId: null,
  });

  const {
    analytics: streamAnalytics,
    showSummary: showAnalyticsSummary,
    startTracking,
    recordSample,
    recordViewerCount,
    finishTracking,
    dismissSummary: dismissAnalyticsSummary,
  } = useStreamAnalytics();

  const { checkHealth, reset: resetHealthAlerts } = useHealthAlerts();

  // Real-time platform viewer analytics
  const {
    viewerData,
    startViewerPolling,
    stopViewerPolling,
  } = useViewerAnalytics();

  // Derive viewer count from real platform analytics
  const viewerCount = viewerData?.totalViewers ?? 0;

  const {
    status: broadcastStatus,
    healthStats,
    guests,
    ejectGuest,
    forgeChat,
    sendForgeChat,
    sendBackstageBrief,
    join: joinDaily,
    waitForLocalTracks,
    startRtmp,
    leave: leaveDaily,
    setProgramCamera,
    setUserName: setBroadcastUserName,
  } = useDailyBroadcast();

  // The host's editable display name — pushed live to guests while broadcasting
  // so an Account-settings rename updates their "Guest of {host}" label and the
  // host tile in real time.
  const { user } = useAuth();
  const hostDisplayName = displayNameOf(user);
  useEffect(() => {
    // Fires on go-live (sets the name client-side, independent of the meeting
    // token) and whenever the host renames while live.
    if (isLive) setBroadcastUserName(hostDisplayName);
  }, [isLive, hostDisplayName, setBroadcastUserName]);

  // Forge Chat unread tracking: count incoming (non-self) messages since the
  // host last viewed the Forge Chat, so the UI can blink for attention and
  // clear once read. Reset if the chat empties (e.g. after a stream ends).
  const [forgeReadCount, setForgeReadCount] = useState(0);
  useEffect(() => {
    if (forgeChat.length < forgeReadCount) setForgeReadCount(0);
  }, [forgeChat.length, forgeReadCount]);
  const forgeChatUnread = forgeChat.slice(forgeReadCount).filter(m => !m.mine).length;
  const markForgeChatRead = useCallback(() => {
    setForgeReadCount(forgeChat.length);
  }, [forgeChat.length]);

  // Audible alert for incoming guest (Forge Chat) messages — a distinct chime
  // the operator can mute or set the volume of. Both are persisted.
  const [forgeChatSoundMuted, setForgeChatSoundMuted] = useState<boolean>(() => {
    try { return localStorage.getItem('studio-forge-sound-muted') === '1'; } catch { return false; }
  });
  const [forgeChatSoundVolume, setForgeChatSoundVolumeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('studio-forge-sound-volume');
      const n = raw == null ? 70 : parseInt(raw, 10);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 70;
    } catch { return 70; }
  });
  const toggleForgeChatSound = useCallback(() => {
    setForgeChatSoundMuted(prev => {
      const next = !prev;
      try { localStorage.setItem('studio-forge-sound-muted', next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  }, []);
  const setForgeChatSoundVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    setForgeChatSoundVolumeState(clamped);
    try { localStorage.setItem('studio-forge-sound-volume', String(clamped)); } catch { /* quota */ }
  }, []);

  // Chime once whenever a new incoming (guest) message arrives, unless muted.
  // Mute/volume are read through refs so changing them never re-fires the
  // sound; only a growing chat with a non-own message does. Messages already
  // present on mount (e.g. after a reconnect) are skipped.
  const forgeSoundSeenRef = useRef<number | null>(null);
  const forgeSoundMutedRef = useRef(forgeChatSoundMuted);
  forgeSoundMutedRef.current = forgeChatSoundMuted;
  const forgeSoundVolumeRef = useRef(forgeChatSoundVolume);
  forgeSoundVolumeRef.current = forgeChatSoundVolume;
  useEffect(() => {
    const { chime, nextSeen } = evaluateChime(forgeSoundSeenRef.current, forgeChat);
    forgeSoundSeenRef.current = nextSeen;
    if (chime && !forgeSoundMutedRef.current) {
      playForgeChime(forgeSoundVolumeRef.current);
    }
  }, [forgeChat]);

  const [compositeStream, setCompositeStream] = useState<MediaStream | null>(null);
  // A compositor spun up solely to bake the cued LUT (and the current look)
  // into a standalone recording made while NOT live. Torn down when recording
  // stops. During a live broadcast we reuse the live compositor instead.
  const recordingCompositorRef = useRef<StreamCompositor | null>(null);
  // Green-room preview compositor: runs when guests are on but we're not yet
  // broadcasting, so the host previews the guest tiles + chosen layout exactly
  // as they'll air. While live, the broadcast compositor owns compositeStream.
  const previewCompositorRef = useRef<StreamCompositor | null>(null);

  // Recordings (declared before goLive so auto-record can reference them)
  const {
    recordings,
    loading: recordingsLoading,
    recordingMode,
    setRecordingMode,
    isRecording: isRecordingWithMode,
    startRecording: startRecordingWithMode,
    stopRecording: stopRecordingWithMode,
    deleteRecording,
    getCloudUrl,
    uploadVideoFile,
  } = useRecordings();

  // ── Media playback source (pre-recorded content as the broadcast feed) ──
  const [mediaPlayback, setMediaPlayback] = useState<{ recordingId: string; title: string } | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [mediaPaused, setMediaPaused] = useState(false);
  const [mediaMonitor, setMediaMonitor] = useState(false);
  // A cue can be "held": kept alive & paused at its position while the broadcast
  // shows the camera, so it can resume from where it left off. onAir tracks
  // whether the cue is currently the broadcast source.
  const [mediaOnAir, setMediaOnAir] = useState(false);
  const [mediaTime, setMediaTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  // Hide the camera PiP over a cued excerpt for a clean full-frame feed.
  const [mediaHideCamera, setMediaHideCamera] = useState(false);
  const toggleMediaCameraPip = useCallback(() => setMediaHideCamera(v => !v), []);
  const mediaElementRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaUrlRef = useRef<string | null>(null);
  const mediaRvfcRef = useRef(0);
  const mediaMonitorRef = useRef(mediaMonitor);
  mediaMonitorRef.current = mediaMonitor;

  /** Fully end the cue and revert to camera (tears the element down). */
  const stopMediaPlayback = useCallback(() => {
    const el = mediaElementRef.current;
    if (el) {
      const vfcEl = el as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
      if (mediaRvfcRef.current && vfcEl.cancelVideoFrameCallback) vfcEl.cancelVideoFrameCallback(mediaRvfcRef.current);
      el.onended = null; el.ontimeupdate = null; el.onloadedmetadata = null; el.ondurationchange = null;
      el.pause();
      el.src = '';
      el.remove();
    }
    mediaRvfcRef.current = 0;
    mediaElementRef.current = null;
    mediaStreamRef.current = null;
    if (mediaUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(mediaUrlRef.current);
    mediaUrlRef.current = null;
    setMediaStream(null);
    setMediaPlayback(null);
    setMediaPaused(false);
    setMediaOnAir(false);
    setMediaTime(0);
    setMediaDuration(0);
  }, []);

  /** Cut back to camera but KEEP the cue paused at its position, so it can be
   * resumed later (e.g. pause for commentary, then continue the video). */
  const holdCueToCamera = useCallback(() => {
    const el = mediaElementRef.current;
    if (!el) return;
    el.pause();
    setMediaPaused(true);
    setMediaStream(null); // compositor falls back to the camera
    setMediaOnAir(false);
  }, []);

  /** Put a held cue back on air and continue from its current position. */
  const resumeCue = useCallback(() => {
    const el = mediaElementRef.current;
    const stream = mediaStreamRef.current;
    if (!el || !stream) return;
    setMediaStream(stream);
    void el.play();
    setMediaPaused(false);
    setMediaOnAir(true);
  }, []);

  /** Seek the cue (progress-bar scrub). */
  const seekMedia = useCallback((t: number) => {
    const el = mediaElementRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(t, el.duration || t));
    setMediaTime(el.currentTime);
  }, []);

  /** Pause/resume the active media source (freezes the broadcast on that frame). */
  const toggleMediaPlayback = useCallback(() => {
    const el = mediaElementRef.current;
    if (!el) return;
    if (el.paused) { void el.play(); setMediaPaused(false); }
    else { el.pause(); setMediaPaused(true); }
  }, []);

  /** Hear the active media source locally (broadcast carries it either way;
   * off by default so speaker audio doesn't echo into the mic). */
  const toggleMediaMonitor = useCallback(() => {
    setMediaMonitor(v => {
      const next = !v;
      if (mediaElementRef.current) mediaElementRef.current.muted = !next;
      return next;
    });
  }, []);

  // Core: play a URL as the broadcast video source (muted element + captureStream
  // — muting only silences local monitoring; the audio still reaches the mix).
  // knownDuration is used because MediaRecorder WebMs (exported excerpts) report
  // el.duration as Infinity/NaN, which would break the progress bar.
  const playUrlAsSource = useCallback(async (
    url: string, info: { recordingId: string; title: string }, knownDuration = 0,
  ): Promise<boolean> => {
    try {
      const el = document.createElement('video');
      el.src = url;
      el.playsInline = true;
      // Muted = local monitor off; captureStream still carries audio to the mix.
      el.muted = !mediaMonitorRef.current;
      // Keep the element attached to the DOM and IN the viewport (Chrome
      // throttles frame production for detached OR off-screen <video>, which
      // starves captureStream and drops the media as the main source while it
      // plays). A 2px, ~invisible corner element paints reliably without showing.
      el.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:2147483647;';
      document.body.appendChild(el);
      await el.play();
      // Frame-callback keep-alive: re-requesting frames keeps the decode
      // pipeline active so captureStream never stalls.
      const vfcEl = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      const keepFrames = () => {
        if (vfcEl.requestVideoFrameCallback) mediaRvfcRef.current = vfcEl.requestVideoFrameCallback(keepFrames);
      };
      keepFrames();
      const stream = (el as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
      if (!stream) { el.pause(); return false; }
      const applyDuration = () => {
        const d = el.duration;
        setMediaDuration(Number.isFinite(d) && d > 0 ? d : (knownDuration || 0));
      };
      el.onended = () => stopMediaPlayback();
      el.ontimeupdate = () => setMediaTime(el.currentTime);
      el.onloadedmetadata = applyDuration;
      el.ondurationchange = applyDuration;
      mediaElementRef.current = el;
      mediaStreamRef.current = stream;
      mediaUrlRef.current = url;
      setMediaStream(stream);
      setMediaPlayback(info);
      setMediaPaused(false);
      setMediaOnAir(true);
      setMediaTime(0);
      applyDuration();
      return true;
    } catch (err) {
      if (import.meta.env.DEV) console.error('Media playback failed:', err);
      return false;
    }
  }, [stopMediaPlayback]);

  const startMediaPlayback = useCallback(async (recording: Recording): Promise<boolean> => {
    stopMediaPlayback();
    // Resolve a playable URL: signed cloud URL, or the local file via its
    // session blob / persisted file handle
    let url: string | null = null;
    if (recording.storage_type === 'cloud' && recording.storage_path) {
      url = await getCloudUrl(recording.storage_path);
    } else {
      const result = await openLocalRecording(recording.id);
      if (result.ok) url = result.url;
    }
    if (!url) return false;
    return playUrlAsSource(url, { recordingId: recording.id, title: recording.title }, recording.duration_seconds || 0);
  }, [getCloudUrl, stopMediaPlayback, playUrlAsSource]);

  const startExcerptPlayback = useCallback(async (meta: ExcerptMeta): Promise<boolean> => {
    stopMediaPlayback();
    const url = await getExcerptUrl(meta.id);
    if (!url) return false;
    return playUrlAsSource(url, { recordingId: `excerpt-${meta.id}`, title: meta.name }, meta.duration || 0);
  }, [stopMediaPlayback, playUrlAsSource]);

  // Reliable progress ticker while a cue is on air (ontimeupdate can be sparse/
  // throttled; this keeps the scrubber moving smoothly with playback).
  useEffect(() => {
    if (!mediaStream) return;
    const id = window.setInterval(() => {
      const el = mediaElementRef.current;
      if (el && !el.paused) setMediaTime(el.currentTime);
    }, 200);
    return () => window.clearInterval(id);
  }, [mediaStream]);

  // Auto-record when going live ("Record when live"). Persisted and shared, so
  // the choice survives reloads and stays in lockstep wherever it's set — the
  // Archive Tools toggle or the record button's "Both" action under the video.
  const [autoRecordOnLive, setAutoRecordOnLive] = useState(() => {
    try { return localStorage.getItem('studio-auto-record-live') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('studio-auto-record-live', autoRecordOnLive ? '1' : '0'); } catch { /* quota */ }
  }, [autoRecordOnLive]);

  // Start a recording that preserves the cued LUT (and the rest of the current
  // look). The cued LUT lives in the compositor, so a raw camera/screen stream
  // would drop it — we record the graded composite instead whenever a look is
  // active, so recordings match the preview and broadcast for the whole take.
  const startGradedRecording = useCallback(async (title?: string) => {
    // Live: the broadcast compositor is already running and carries the LUT,
    // filters, corrections, and overlays — record its exact output.
    const liveComposite = compositorRef.current?.getOutputStream();
    if (liveComposite) { startRecordingWithMode(liveComposite, title); return; }

    const raw = screenStream || cameraStream;
    if (!raw) return;

    // Not live, no LUT library, and no mic effects engaged → record the raw
    // source unchanged (nothing to bake in, so skip the compositing cost).
    if (!luts.length && !audioEffects.enabled) { startRecordingWithMode(raw, title); return; }

    // Not live but a look or the FX rack is active → route through a dedicated
    // compositor so the cued grade AND mic effects are baked into the file for
    // the whole take, and changing either mid-take applies immediately (the
    // compositor tracks scene state). Fall back to the raw source if it fails.
    try {
      const height = captureQuality === '720p' ? 720 : 1080;
      const comp = new StreamCompositor(height, orientation);
      comp.update(compositorInputsRef.current);
      const out = await comp.start();
      recordingCompositorRef.current = comp;
      startRecordingWithMode(out, title);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Recording compositor failed; recording raw source:', err);
      startRecordingWithMode(raw, title);
    }
  }, [screenStream, cameraStream, luts.length, audioEffects.enabled, captureQuality, orientation, startRecordingWithMode]);

  const toggleRecording = useCallback(() => {
    if (isRecordingWithMode) {
      stopRecordingWithMode();
      logActivity('Stopped recording');
      return;
    }
    if (!(screenStream || cameraStream)) return;
    void startGradedRecording();
    logActivity('Started recording');
  }, [isRecordingWithMode, screenStream, cameraStream, startGradedRecording, stopRecordingWithMode]);

  // Activate live-only side effects. Called only once the broadcast is
  // actually established — never optimistically.
  const activateLiveState = useCallback(() => {
    setIsLive(true);
    logActivity('Went live');
    startTracking();
    resetHealthAlerts();
    startViewerPolling();
    if (autoRecordOnLive) {
      // Record the graded composite (LUT + filters + overlays), not the raw
      // source — the broadcast compositor is already running at this point.
      void startGradedRecording(`Live Recording ${new Date().toLocaleString()}`);
    }
  }, [startTracking, resetHealthAlerts, startViewerPolling, autoRecordOnLive, startGradedRecording]);

  // Enter the WAITING ROOM (backstage): join the Daily room and publish the
  // composite so invited guests can see/hear the host and prep together — but
  // do NOT start RTMP. Going live afterwards reuses this same room + compositor,
  // so guests never reconnect.
  const enterWaitingRoom = useCallback(async () => {
    if (isLive || isStartingLive || isStoppingLive || isBackstage || isEnteringBackstage) return;
    setIsEnteringBackstage(true);
    try {
      const result = await prepareRoom();
      if (!result.success || !result.daily_room_url || !result.daily_token) {
        toast({
          title: 'Couldn’t open the waiting room',
          description: result.error || 'Please try again.',
          variant: 'destructive',
        });
        return;
      }
      // Same compositor setup as go-live, just without RTMP — the host sees the
      // exact program preview and guests see the host's face (hostcam track).
      const broadcastHeight = captureQuality === '720p' ? 720 : 1080;
      const compositor = new StreamCompositor(broadcastHeight, orientation);
      compositorRef.current = compositor;
      compositor.update(compositorInputsRef.current);
      const composite = await compositor.start();
      setCompositeStream(composite);

      await joinDaily(result.daily_room_url, result.daily_token, {
        videoSource: composite.getVideoTracks()[0],
        audioSource: composite.getAudioTracks()[0],
      });
      setIsBackstage(true);
      logActivity('Opened the waiting room');
      toast({
        title: 'Waiting room open',
        description: 'Invited guests can join to prep with you. You’re not broadcasting yet.',
      });
    } catch (err) {
      if (import.meta.env.DEV) console.error('Enter waiting room error:', err);
      compositorRef.current?.stop();
      compositorRef.current = null;
      setCompositeStream(null);
      await leaveDaily();
      toast({
        title: 'Couldn’t open the waiting room',
        description: 'Could not establish the connection. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsEnteringBackstage(false);
    }
  }, [isLive, isStartingLive, isStoppingLive, isBackstage, isEnteringBackstage, captureQuality, orientation, toast, joinDaily, leaveDaily]);

  // Leave the waiting room without going live: disconnect the host but keep the
  // 'preparing' session/room so waiting guests aren't kicked and a later Enter /
  // Go Live reuses the same room.
  const leaveWaitingRoom = useCallback(async () => {
    if (!isBackstageRef.current) return;
    setIsBackstage(false);
    try { await leaveDaily(); } catch { /* noop */ }
    compositorRef.current?.stop();
    compositorRef.current = null;
    setCompositeStream(null);
    logActivity('Left the waiting room');
  }, [leaveDaily]);

  const goLive = useCallback(async () => {
    if (isLive || isStartingLive || isStoppingLive || isEnteringBackstage) return;
    setIsStartingLive(true);

    // Broadcast at 1080p unless the user chose 720p; 4K capture still broadcasts
    // at 1080p (Daily's composed RTMP output ceiling).
    const broadcastHeight = captureQuality === '720p' ? 720 : 1080;
    const longSide = Math.round(broadcastHeight * 16 / 9);
    const rtmpSize = orientation === 'portrait'
      ? { width: broadcastHeight, height: longSide }
      : { width: longSide, height: broadcastHeight };

    try {
      const result = await startStream('Live Stream');
      if (!result.success) {
        toast({
          title: 'Failed to go live',
          description: result.error || 'Check your stream destinations',
          variant: 'destructive',
        });
        return;
      }

      sessionIdRef.current = result.session_id || null;

      // ── Already in the waiting room: reuse the joined room + running
      //    compositor and just start RTMP on it. No reconnect — waiting guests
      //    stay in place. ──
      if (isBackstageRef.current) {
        if (!result.daily_rtmp_endpoints?.length) {
          // Destination-less (no RTMP) — just flip the studio to live in place.
          setIsBackstage(false);
          activateLiveState();
          toast({ title: '🔴 You\'re Live!', description: result.message || 'Stream started successfully' });
          return;
        }
        try {
          await waitForLocalTracks();
          await startRtmp(result.daily_rtmp_endpoints, rtmpSize);
          setIsBackstage(false);
          activateLiveState();
          toast({
            title: '🔴 Broadcasting Live!',
            description: result.message || `Streaming to ${result.destinations_count} destination(s)`,
          });
        } catch (rtmpErr) {
          if (import.meta.env.DEV) console.error('Start RTMP error:', rtmpErr);
          // Keep the waiting room intact so the host can retry; just undo the
          // backend promotion of the session to live.
          try { await stopStream(sessionIdRef.current || undefined); } catch { /* noop */ }
          sessionIdRef.current = null;
          toast({
            title: '⚠️ Couldn’t start the broadcast',
            description: 'You’re still in the waiting room — please try Go Live again.',
            variant: 'destructive',
          });
        }
        return;
      }

      // ── Cold start (no waiting room): join Daily and start RTMP together. ──
      if (result.daily_room_url && result.daily_token && result.daily_rtmp_endpoints?.length) {
        try {
          // Composite sources + filter + overlays into the broadcast stream —
          // viewers see exactly what the studio preview shows.
          const compositor = new StreamCompositor(broadcastHeight, orientation);
          compositorRef.current = compositor;
          compositor.update(compositorInputsRef.current);
          const composite = await compositor.start();
          setCompositeStream(composite);

          await joinDaily(result.daily_room_url, result.daily_token, {
            videoSource: composite.getVideoTracks()[0],
            audioSource: composite.getAudioTracks()[0],
          });
          // (The raw host camera is published as a custom track by the effect
          // that watches cameraStream while live — see below.)
          // Wait for local tracks to settle before starting RTMP
          await waitForLocalTracks();
          await startRtmp(result.daily_rtmp_endpoints, rtmpSize);
          activateLiveState();
          toast({
            title: '🔴 Broadcasting Live!',
            description: result.message || `Streaming to ${result.destinations_count} destination(s)`,
          });
        } catch (dailyErr) {
          if (import.meta.env.DEV) console.error('Daily broadcast error:', dailyErr);
          compositorRef.current?.stop();
          compositorRef.current = null;
          setCompositeStream(null);
          // Clean up the backend session that was created
          try {
            await stopStream(sessionIdRef.current || undefined);
          } catch { /* noop */ }
          sessionIdRef.current = null;
          await leaveDaily();
          toast({
            title: '⚠️ Browser broadcast failed',
            description: 'Could not establish the broadcast connection. Please try again.',
            variant: 'destructive',
          });
        }
      } else {
        activateLiveState();
        toast({
          title: '🔴 You\'re Live!',
          description: result.message || 'Stream started successfully',
        });
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Go live error:', err);
      toast({
        title: 'Stream error',
        description: 'Could not connect to the streaming service',
        variant: 'destructive',
      });
    } finally {
      setIsStartingLive(false);
    }
  }, [isLive, isStartingLive, isStoppingLive, isEnteringBackstage, captureQuality, orientation, toast, joinDaily, waitForLocalTracks, startRtmp, leaveDaily, activateLiveState]);

  // Keep the host-camera custom track guests see in sync while live OR in the
  // waiting room: republish when the host switches cameras, and clear it when
  // the camera turns off (cameraStream becomes null → guests fall back to the
  // host avatar).
  useEffect(() => {
    if (!isLive && !isBackstage) return;
    setProgramCamera(cameraStream?.getVideoTracks()[0] ?? null);
  }, [cameraStream, isLive, isBackstage, setProgramCamera]);

  // Push the shared topic/agenda note to guests whenever it changes while the
  // host is backstage or live (and on entering, catching up present guests;
  // late joiners are caught up by the participant-joined re-emit in the hook).
  useEffect(() => {
    if (!isBackstage && !isLive) return;
    sendBackstageBrief(backstageBrief);
  }, [backstageBrief, isBackstage, isLive, sendBackstageBrief]);

  const stopLive = useCallback(async () => {
    if (isStoppingLive || isStartingLive) return;
    setIsStoppingLive(true);
    setIsLive(false);
    logActivity('Ended stream');
    stopViewerPolling();

    try {
      // End any pre-recorded media playback
      stopMediaPlayback();

      // Stop auto-recording if active
      if (isRecordingWithMode) stopRecordingWithMode();

      // Finalize analytics before leaving
      finishTracking();

      // Leave Daily room (stops RTMP automatically)
      await leaveDaily();

      // Tear down the broadcast compositor
      compositorRef.current?.stop();
      compositorRef.current = null;
      setCompositeStream(null);

      await stopStream(sessionIdRef.current || undefined);
      sessionIdRef.current = null;
      toast({ title: 'Stream ended', description: 'Check your stream summary for details.' });
    } catch (err) {
      if (import.meta.env.DEV) console.error('Stop stream error:', err);
    } finally {
      setIsStoppingLive(false);
    }
  }, [isStoppingLive, isStartingLive, toast, leaveDaily, finishTracking, stopViewerPolling, isRecordingWithMode, stopRecordingWithMode, stopMediaPlayback]);

  // On mount: clean up sessions left "live" by a previous tab close or crash.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    (async () => {
      try {
        const status = await getStreamStatus();
        if (status.success && status.is_live) {
          await stopStream();
          toast({
            title: 'Previous session cleaned up',
            description: 'A stream left running from a previous session was ended.',
          });
        }
      } catch { /* non-fatal */ }
    })();
  }, [toast]);

  // Best-effort stop when the tab closes mid-stream (keepalive survives unload).
  const accessTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isLive) return;
    supabase.auth.getSession().then(({ data }) => {
      accessTokenRef.current = data.session?.access_token ?? null;
    });
    const handlePageHide = () => {
      if (!accessTokenRef.current) return;
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stream-manager`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessTokenRef.current}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ action: 'stop', session_id: sessionIdRef.current ?? undefined }),
      }).catch(() => { /* page is going away */ });
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [isLive]);

  // Record health samples and check for alerts
  useEffect(() => {
    if (isLive && broadcastStatus === 'broadcasting' && healthStats) {
      recordSample(healthStats);
      checkHealth(healthStats);
    }
  }, [healthStats, isLive, broadcastStatus, recordSample, checkHealth]);

  // Record real viewer counts into analytics timeline
  useEffect(() => {
    if (isLive && viewerData) {
      recordViewerCount(viewerData.totalViewers);
    }
  }, [isLive, viewerData, recordViewerCount]);

  // Camera/mic state no longer toggles the published Daily track: the
  // broadcast track is the compositor canvas and must stay on. Camera on/off
  // renders through the compositor; mic mute flows through track.enabled
  // into the audio mix.

  // Database-backed destinations
  const {
    destinations,
    addDestination,
    updateDestination,
    removeDestination,
    toggleDestination,
    setAllDestinationsEnabled,
  } = useStreamDestinations();

  // Unified chat: aggregates Twitch + YouTube chat while live
  const { chatMessages, chatStatuses } = useUnifiedChat(destinations, isLive);

  const [polls, setPolls] = useState<Poll[]>([]);
  const addPoll = useCallback((question: string, options: string[]) => {
    setPolls(prev => [...prev, {
      id: crypto.randomUUID(),
      question,
      options: options.map(text => ({ text, votes: 0 })),
      active: false,
    }]);
  }, []);
  const togglePoll = useCallback((id: string) => {
    setPolls(prev => prev.map(p => p.id === id ? { ...p, active: !p.active } : { ...p, active: false }));
  }, []);
  const votePoll = useCallback((pollId: string, optionIndex: number) => {
    setPolls(prev => prev.map(p => {
      if (p.id !== pollId) return p;
      const options = p.options.map((o, i) => i === optionIndex ? { ...o, votes: o.votes + 1 } : o);
      return { ...p, options };
    }));
  }, []);
  const removePoll = useCallback((id: string) => {
    // Removing an active poll also takes it off the broadcast overlay
    setPolls(prev => prev.filter(p => p.id !== id));
  }, []);

  const [questions, setQuestions] = useState<Question[]>([]);
  const addQuestion = useCallback((q: Omit<Question, 'id' | 'timestamp' | 'highlighted'>) => {
    setQuestions(prev => [{ ...q, id: crypto.randomUUID(), timestamp: new Date(), highlighted: false }, ...prev]);
  }, []);
  const highlightQuestion = useCallback((id: string) => {
    setQuestions(prev => prev.map(q => ({ ...q, highlighted: q.id === id ? !q.highlighted : false })));
  }, []);

  const {
    scheduledStreams,
    addScheduledStream,
    removeScheduledStream,
    refetch: refetchSchedules,
  } = useScheduledStreams();

  // ── In-app schedule runner ──
  // Scheduled streams execute here, in the open studio tab: at the scheduled
  // time the recording (cloud or local) starts playing as the broadcast
  // source and the stream goes live automatically. The backend cron cannot
  // do this — a browser is required for the media + WebRTC pipeline.
  const activeScheduleRef = useRef<string | null>(null);
  const runnerBusyRef = useRef(false);

  useEffect(() => {
    const check = async () => {
      if (runnerBusyRef.current || activeScheduleRef.current || isLiveRef.current) return;
      const now = Date.now();
      const due = scheduledStreams.find(s =>
        s.status === 'pending' &&
        new Date(s.scheduled_at).getTime() <= now &&
        now - new Date(s.scheduled_at).getTime() < 10 * 60_000, // grace window
      );
      if (!due) return;

      runnerBusyRef.current = true;
      try {
        activeScheduleRef.current = due.id;
        await supabase.from('scheduled_streams').update({ status: 'running' }).eq('id', due.id);
        refetchSchedules();

        if (due.recording_id) {
          const recording = recordings.find(r => r.id === due.recording_id);
          const ok = recording ? await startMediaPlayback(recording) : false;
          if (!ok) {
            toast({
              title: 'Scheduled stream failed',
              description: `Could not open "${due.recording_title ?? 'the recording'}". Local files must be reachable from this browser (keep file access granted).`,
              variant: 'destructive',
            });
            await supabase.from('scheduled_streams').update({ status: 'failed' }).eq('id', due.id);
            refetchSchedules();
            activeScheduleRef.current = null;
            return;
          }
        }

        toast({ title: '⏰ Scheduled stream starting', description: due.title });
        await goLive();
        if (!isLiveRef.current) {
          stopMediaPlayback();
          await supabase.from('scheduled_streams').update({ status: 'failed' }).eq('id', due.id);
          refetchSchedules();
          activeScheduleRef.current = null;
        }
      } finally {
        runnerBusyRef.current = false;
      }
    };
    const interval = setInterval(check, 30_000);
    check();
    return () => clearInterval(interval);
  }, [scheduledStreams, recordings, startMediaPlayback, stopMediaPlayback, goLive, toast, refetchSchedules]);

  // Recording finished while a scheduled stream is live → end the broadcast
  useEffect(() => {
    if (activeScheduleRef.current && isLive && !mediaPlayback && !runnerBusyRef.current) {
      stopLive();
    }
  }, [mediaPlayback, isLive, stopLive]);

  // Broadcast ended → mark the schedule completed
  useEffect(() => {
    if (activeScheduleRef.current && !isLive && !isStartingLive && !isStoppingLive && !runnerBusyRef.current) {
      const id = activeScheduleRef.current;
      activeScheduleRef.current = null;
      supabase.from('scheduled_streams').update({ status: 'completed' }).eq('id', id)
        .then(() => refetchSchedules());
    }
  }, [isLive, isStartingLive, isStoppingLive, refetchSchedules]);

  // ── Scenes switcher: derive the tile list + active selection, and take. ──
  // Tiles come straight from the live sources so each shows a real feed.
  const scenes = useMemo<Scene[]>(() => {
    const list: Scene[] = [];
    if (isCameraOn && cameraStream) list.push({ id: 'camera1', kind: 'camera1', label: 'Camera 1', stream: cameraStream, hasAudio: false });
    if (isCamera2On && camera2Stream) list.push({ id: 'camera2', kind: 'camera2', label: 'Camera 2', stream: camera2Stream, hasAudio: false });
    if (isScreenSharing && screenStream) {
      list.push(slideshow
        ? { id: 'slides', kind: 'slides', label: 'Slides', stream: screenStream, hasAudio: false }
        : { id: 'screen', kind: 'screen', label: 'Screen Share', stream: screenStream, hasAudio: false });
    }
    if (mediaPlayback && mediaStream) {
      list.push({ id: 'media', kind: 'media', label: mediaPlayback.title || 'Media', stream: mediaStream, hasAudio: true });
    }
    for (const g of guests) {
      list.push({
        id: `guest:${g.sessionId}`,
        kind: 'guest',
        label: g.userName,
        stream: g.videoTrack ? new MediaStream([g.videoTrack]) : null,
        hasAudio: true,
        guestId: g.sessionId,
      });
    }
    return list;
  }, [isCameraOn, cameraStream, isCamera2On, camera2Stream, isScreenSharing, screenStream, slideshow, mediaPlayback, mediaStream, guests]);

  // The scene actually on air: featured guest wins, else the forced program,
  // else the auto-priority pick (mirrors the compositor).
  const activeSceneId = useMemo<string>(() => {
    if (featuredGuestId) return `guest:${featuredGuestId}`;
    if (program === 'camera1') return 'camera1';
    if (program === 'camera2') return 'camera2';
    if (program === 'screen') return slideshow ? 'slides' : 'screen';
    if (program === 'media') return 'media';
    if (mediaPlayback && mediaStream) return 'media';
    if (isScreenSharing && screenStream) return slideshow ? 'slides' : 'screen';
    if (isCameraOn && cameraStream) return 'camera1';
    if (isCamera2On && camera2Stream) return 'camera2';
    return '';
  }, [featuredGuestId, program, slideshow, mediaPlayback, mediaStream, isScreenSharing, screenStream, isCameraOn, cameraStream, isCamera2On, camera2Stream]);

  const takeScene = useCallback((id: string) => {
    // Snapshot the current frame on every active compositor so the transition
    // overlays the outgoing scene; the program change below reveals the new one.
    compositorRef.current?.beginTransition(transitionType);
    recordingCompositorRef.current?.beginTransition(transitionType);
    previewCompositorRef.current?.beginTransition(transitionType);
    if (id.startsWith('guest:')) {
      setFeaturedGuestId(id.slice('guest:'.length));
      return;
    }
    setFeaturedGuestId(null);
    switch (id) {
      case 'camera1': setProgram('camera1'); break;
      case 'camera2': setProgram('camera2'); break;
      case 'screen':
      case 'slides': setProgram('screen'); break;
      case 'media': setProgram('media'); break;
      default: setProgram('auto');
    }
  }, [transitionType]);

  // Safety: if the on-air source disappears (guest leaves, camera/screen/media
  // stops), fall back to auto so the program never sticks on a dead source.
  useEffect(() => {
    if (featuredGuestId && !guests.some(g => g.sessionId === featuredGuestId)) setFeaturedGuestId(null);
  }, [guests, featuredGuestId]);
  useEffect(() => {
    const live =
      program === 'auto' ? true :
      program === 'camera1' ? (isCameraOn && !!cameraStream) :
      program === 'camera2' ? (isCamera2On && !!camera2Stream) :
      program === 'screen' ? (isScreenSharing && !!screenStream) :
      program === 'media' ? (!!mediaPlayback && !!mediaStream) : true;
    if (!live) setProgram('auto');
  }, [program, isCameraOn, cameraStream, isCamera2On, camera2Stream, isScreenSharing, screenStream, mediaPlayback, mediaStream]);

  // Keep the broadcast compositor in lockstep with the studio scene state.
  // The ref mirror lets goLive seed a fresh compositor without depending on
  // every piece of scene state.
  useEffect(() => {
    const inputs: CompositorInputs = {
      cameraStream,
      screenStream,
      camera2Stream,
      mediaStream,
      mediaHideCamera,
      isCameraOn,
      isCamera2On,
      isScreenSharing,
      filter: activeFilter,
      grade: colorGrade,
      lut,
      logo,
      extraAudio: [
        ...extraMics
          .filter(m => m.stream)
          .map(m => ({ id: m.id, stream: m.stream!, volume: m.volume })),
        // Music bed as its own gain-controlled source in the broadcast mix.
        ...(musicStream ? [{ id: 'music-bed', stream: musicStream, volume: musicVolume }] : []),
        // Control Room Sound Fx cues fire through their own full-volume source.
        ...(sfxStream ? [{ id: 'control-room-sfx', stream: sfxStream, volume: 100 }] : []),
      ],
      lowerThird,
      activePoll: polls.find(p => p.active) ?? null,
      highlightedQuestion: questions.find(q => q.highlighted) ?? null,
      volume,
      eq: eqGains,
      audioEffects,
      pipPosition,
      guests: guests.map(g => ({
        sessionId: g.sessionId,
        userName: g.userName,
        videoTrack: g.videoTrack,
      })),
      guestLayout,
      program,
      featuredGuestId,
    };
    compositorInputsRef.current = inputs;
    compositorRef.current?.update(inputs);
    // The standalone recording compositor follows the same scene state, so a
    // LUT cued on/off mid-take applies to the file immediately.
    recordingCompositorRef.current?.update(inputs);
    // The green-room preview compositor follows too, so guests joining/leaving
    // and layout switches reflect in the preview immediately.
    previewCompositorRef.current?.update(inputs);
  }, [cameraStream, screenStream, camera2Stream, mediaStream, mediaHideCamera, isCameraOn, isCamera2On, isScreenSharing, activeFilter, colorGrade, lut, lutEnabled, logo, extraMics, musicStream, musicVolume, sfxStream, lowerThird, polls, questions, volume, eqGains, audioEffects, pipPosition, guests, guestLayout, program, featuredGuestId]);

  // Run/tear down the green-room preview compositor. Active only with guests on
  // and while NOT broadcasting — during a broadcast the live compositor owns the
  // preview. Rebuilds if capture size/orientation change (rare); guest and
  // layout changes are handled live by the sync effect above.
  useEffect(() => {
    // Also excludes the stop-in-progress window: the broadcast compositor is
    // torn down asynchronously, and isStoppingLive flipping back to false once
    // that's done re-runs this effect to (re)start the green-room preview.
    const shouldPreview = !isLive && !isStartingLive && !isStoppingLive && guests.length > 0;

    if (shouldPreview && !previewCompositorRef.current && !compositorRef.current) {
      let cancelled = false;
      (async () => {
        try {
          const height = captureQuality === '720p' ? 720 : 1080;
          const comp = new StreamCompositor(height, orientation);
          comp.update(compositorInputsRef.current);
          const out = await comp.start();
          if (cancelled) { comp.stop(); return; }
          previewCompositorRef.current = comp;
          setCompositeStream(out);
        } catch (err) {
          if (import.meta.env.DEV) console.error('Preview compositor failed:', err);
        }
      })();
      return () => { cancelled = true; };
    }

    if (!shouldPreview && previewCompositorRef.current) {
      const comp = previewCompositorRef.current;
      const out = comp.getOutputStream();
      comp.stop();
      previewCompositorRef.current = null;
      // Only clear if the preview owns the current composite — going live sets
      // its own broadcast stream, which we must not clobber.
      setCompositeStream(prev => (prev === out ? null : prev));
    }
  }, [isLive, isStartingLive, isStoppingLive, guests.length, captureQuality, orientation]);

  // Tear down the standalone recording compositor once its recording stops —
  // it exists only to bake the current look into that one file.
  useEffect(() => {
    if (!isRecordingWithMode && recordingCompositorRef.current) {
      recordingCompositorRef.current.stop();
      recordingCompositorRef.current = null;
    }
  }, [isRecordingWithMode]);

  // Tear down the compositors if the provider unmounts mid-broadcast/recording
  useEffect(() => {
    return () => {
      compositorRef.current?.stop();
      compositorRef.current = null;
      recordingCompositorRef.current?.stop();
      recordingCompositorRef.current = null;
      previewCompositorRef.current?.stop();
      previewCompositorRef.current = null;
    };
  }, []);




  const value: StudioContextType = {
    themeMode, toggleTheme,
    activePanel, setActivePanel, graphicsSection, setGraphicsSection,
    mediaLibrarySection, setMediaLibrarySection,
    isLive, isStartingLive, isStoppingLive,
    isBackstage, isEnteringBackstage, enterWaitingRoom, leaveWaitingRoom,
    backstageBrief, setBackstageBrief,
    isRecording: isRecordingWithMode, isCameraOn, isMicOn, isScreenSharing,
    cameraStream, screenStream,
    toggleCamera, toggleMic, toggleScreenShare, toggleRecording,
    slideshow, loadSlideshow, slideNext, slidePrev, slideGoTo, closeSlideshow,
    captureQuality, setCaptureQuality,
    mirrorPreview, setMirrorPreview,
    orientation, setOrientation,
    videoDevices, refreshDevices, hardRefreshDevices, selectedCameraId, selectCamera,
    camera2Stream, isCamera2On, selectedCamera2Id, setSelectedCamera2Id, toggleCamera2,
    switchCamera, setPipCamera,
    selectedMicId, selectMic,
    audioDevices, extraMics, addExtraMic, removeExtraMic,
    setExtraMicDevice, setExtraMicVolume, toggleExtraMic,
    musicTracks, musicPlayingId, musicPlaying, musicVolume, musicLoop, musicMonitor,
    addMusicFile, removeMusicTrack, playMusicTrack, toggleMusicPlayback, stopMusic,
    setMusicVolume, toggleMusicLoop, toggleMusicMonitor,
    mediaPlayback, startMediaPlayback, startExcerptPlayback, stopMediaPlayback,
    mediaPaused, mediaMonitor, toggleMediaPlayback, toggleMediaMonitor,
    mediaOnAir, mediaTime, mediaDuration, holdCueToCamera, resumeCue, seekMedia,
    mediaHideCamera, toggleMediaCameraPip,
    goLive, stopLive,
    broadcastStatus,
    healthStats,
    guests,
    ejectGuest,
    forgeChat,
    sendForgeChat,
    forgeChatUnread,
    markForgeChatRead,
    forgeChatSoundMuted,
    forgeChatSoundVolume,
    toggleForgeChatSound,
    setForgeChatSoundVolume,
    guestLayout,
    setGuestLayout,
    scenes,
    activeSceneId,
    program,
    takeScene,
    transitionType,
    setTransitionType,
    scenesOpen,
    setScenesOpen,
    guestVolumes,
    setGuestVolume,
    compositeStream,
    viewerCount,
    platformViewers: viewerData?.platforms ?? null,
    streamAnalytics,
    showAnalyticsSummary,
    dismissAnalyticsSummary,
    volume, setVolume,
    activeFilter, setActiveFilter,
    colorGrade, updateColorGrade, resetColorGrade,
    lut, lutEnabled, luts, cuedLutId, loadLutFile, cueLut, removeLut,
    eqGains, setEqBand, resetEq,
    audioEffects, setAudioEffect, applyAudioPreset, toggleAudioEffects, resetAudioEffects,
    pipPosition, setPipPosition,
    logo, loadLogoFile, updateLogo, clearLogo, setMotionLogoOverlay,
    controlRoomSources, activeControlRoomId, addControlRoomSource,
    updateControlRoomSource, removeControlRoomSource,
    putControlRoomSourceOnAir, takeControlRoomOffAir,
    controlRoomSounds, playingControlRoomSoundId,
    addControlRoomSound, updateControlRoomSound, removeControlRoomSound,
    playControlRoomSound, stopControlRoomSound,
    lowerThird,
    previewLowerThird, previewLowerThirdId, setPreviewLowerThirdId,
    lowerThirds, activeLowerThirdId, addLowerThird, removeLowerThird,
    updateLowerThirdItem, cueLowerThird,
    destinations, addDestination, updateDestination, removeDestination, toggleDestination,
    setAllDestinationsEnabled,
    polls, addPoll, togglePoll, votePoll, removePoll,
    questions, addQuestion, highlightQuestion,
    chatMessages, chatStatuses,
    scheduledStreams, addScheduledStream, removeScheduledStream,
    recordings,
    recordingsLoading,
    recordingMode,
    setRecordingMode,
    startGradedRecording,
    stopRecordingWithMode,
    deleteRecording,
    getCloudUrl,
    uploadVideoFile,
    autoRecordOnLive,
    setAutoRecordOnLive,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
