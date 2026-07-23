import {
  createContext, useContext, useState, useCallback, useRef, useEffect, useMemo,
} from 'react';
import { tokenizeScript, matchTranscript, normalizeWord, type ScriptWord } from '@/lib/teleprompterMatch';
import { WhisperEngine, type WhisperStatus, type WhisperStats } from '@/lib/whisperEngine';
import { extractTextFromFile } from '@/lib/documentImport';

/** A saved teleprompter script, for quick load (incl. imported .txt/PDF). */
export interface TeleprompterDoc {
  id: string;
  name: string;
  text: string;
}

/** Max saved documents kept for quick load. */
const MAX_DOCS = 4;
import { useToast } from '@/hooks/use-toast';

/**
 * Teleprompter state — kept in its own context (not StudioContext, which is
 * huge and re-renders many consumers). The word pointer updates several times
 * a second while the host reads aloud, so isolating it here keeps the studio's
 * heavier subtree from re-rendering on every recognized word.
 *
 * Voice-follow uses the Web Speech API (Chrome/Edge). Recognition opens its
 * OWN audio capture, independent of the studio's getUserMedia broadcast mic —
 * they coexist on desktop Chrome/Edge, muting the studio mic does NOT stop
 * recognition, and while listening Chrome streams audio to Google's service.
 * Where speech recognition is unavailable or the mic is blocked, the overlay
 * falls back to a constant-rate auto-scroll.
 */

// ── Minimal SpeechRecognition types (the TS DOM lib doesn't ship them) ──
interface SRAlternative { transcript: string; }
interface SRResult { readonly length: number;[index: number]: SRAlternative; }
interface SRResultList { readonly length: number;[index: number]: SRResult; }
interface SREvent extends Event { resultIndex: number; results: SRResultList; }
interface SRErrorEvent extends Event { error: string; }
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognition;
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export type TeleprompterMode = 'speech' | 'auto';
export type TeleprompterStatus = 'idle' | 'running' | 'paused';
export type TeleprompterEngine = 'webspeech' | 'whisper' | null;
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

interface TeleprompterContextType {
  script: string;
  setScript: (s: string) => void;
  visible: boolean;
  setVisible: (v: boolean) => void;
  opacity: number;
  setOpacity: (n: number) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  scrollSpeed: number;
  setScrollSpeed: (n: number) => void;
  speechSupported: boolean;
  speechError: string | null;
  mode: TeleprompterMode;
  status: TeleprompterStatus;
  wordIndex: number;
  words: ScriptWord[];
  start: () => void;
  pause: () => void;
  reset: () => void;
  /** Which detection engine is active: fast browser recognition, on-device
   * Whisper (for Brave/Safari/Firefox), or none (auto-scroll fallback). */
  engine: TeleprompterEngine;
  /** On-device model lifecycle (Whisper engine only). */
  modelStatus: ModelStatus;
  modelProgress: number;
  /** True once an engine is actively listening for speech. */
  listening: boolean;
  /** Live mic input level 0–100 (Whisper engine), for the "hearing you" meter. */
  micLevel: number;
  /** Label of the microphone the voice engine is capturing. */
  micLabel: string | null;
  /** On-device voice-follow tuning (Whisper engine only), in milliseconds.
   * `voiceHopMs` = how soon a spoken word is picked up (lower = snappier);
   * `voiceContextMs` = audio context per pass (higher = more accurate). */
  voiceHopMs: number;
  setVoiceHopMs: (n: number) => void;
  voiceContextMs: number;
  setVoiceContextMs: (n: number) => void;
  /** Auto-stabilize: engine shrinks context under latency pressure to fight lag. */
  voiceAdaptive: boolean;
  setVoiceAdaptive: (b: boolean) => void;
  /** Try the WebGPU provider (falls back to CPU/WASM if unsupported). */
  voiceUseGpu: boolean;
  setVoiceUseGpu: (b: boolean) => void;
  /** Live inference telemetry (Whisper engine), null until the first pass. */
  voiceStats: WhisperStats | null;
  /** Saved script documents (max 4) for quick load, incl. imported .txt/PDF. */
  documents: TeleprompterDoc[];
  /** Import a .txt/PDF file → save as a document and load it. Throws on failure. */
  importDocument: (file: File) => Promise<void>;
  /** Load a saved document's text into the editor. */
  loadDocument: (id: string) => void;
  /** Delete a saved document. */
  removeDocument: (id: string) => void;
  /** Save the current editor text as a new document (name defaults to first line). */
  saveCurrentDocument: (name?: string) => void;
}

const STORAGE_KEY = 'studio-teleprompter';

/**
 * Fired on `window` by the studio whenever the AV Settings microphone changes
 * (`studio-mic-id` in localStorage). The teleprompter listens for it to move
 * its on-device voice engine to the new mic live. Same-window only — a plain
 * `storage` event doesn't fire in the window that made the write.
 */
export const MIC_CHANGED_EVENT = 'studio-mic-changed';

interface PersistedState {
  script: string;
  opacity: number;
  fontSize: number;
  scrollSpeed: number;
  voiceHopMs: number;
  voiceContextMs: number;
  voiceAdaptive: boolean;
  voiceUseGpu: boolean;
  documents: TeleprompterDoc[];
}

const DEFAULTS: PersistedState = {
  script: '',
  opacity: 65,
  fontSize: 28,
  scrollSpeed: 40,
  voiceHopMs: 450,     // ≈ follow latency; matches WhisperEngine DEFAULT_HOP_SEC
  voiceContextMs: 1400, // audio per pass; matches WhisperEngine DEFAULT_CONTEXT_SEC
  voiceAdaptive: true,  // auto-stabilize on by default (fights the occasional lag)
  voiceUseGpu: false,   // WASM by default; GPU is an explicit opt-in
  documents: [],
};

const makeDoc = (name: string, text: string): TeleprompterDoc => ({
  id: (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
  name: (name.trim() || 'Untitled').slice(0, 40),
  text,
});

// Keep in sync with WhisperEngine's clamp bounds so the sliders can't request
// a value the engine will silently reject.
const VOICE_HOP_MIN = 300, VOICE_HOP_MAX = 1200;
const VOICE_CONTEXT_MIN = 800, VOICE_CONTEXT_MAX = 2500;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const TeleprompterContext = createContext<TeleprompterContextType | null>(null);

export function TeleprompterProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();

  // ── Persisted settings (single key, lazy-init + try/catch, write-through) ──
  const [persisted, setPersisted] = useState<PersistedState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) as Partial<PersistedState> };
    } catch { /* defaults */ }
    return DEFAULTS;
  });
  const writeThrough = useCallback((next: PersistedState) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }, []);

  const setScript = useCallback((script: string) => {
    setPersisted(prev => { const next = { ...prev, script }; writeThrough(next); return next; });
  }, [writeThrough]);
  const setOpacity = useCallback((opacity: number) => {
    setPersisted(prev => { const next = { ...prev, opacity: clamp(Math.round(opacity), 0, 100) }; writeThrough(next); return next; });
  }, [writeThrough]);
  const setFontSize = useCallback((fontSize: number) => {
    setPersisted(prev => { const next = { ...prev, fontSize: clamp(Math.round(fontSize), 18, 48) }; writeThrough(next); return next; });
  }, [writeThrough]);
  const setScrollSpeed = useCallback((scrollSpeed: number) => {
    setPersisted(prev => { const next = { ...prev, scrollSpeed: clamp(Math.round(scrollSpeed), 10, 120) }; writeThrough(next); return next; });
  }, [writeThrough]);
  const setVoiceHopMs = useCallback((voiceHopMs: number) => {
    setPersisted(prev => { const next = { ...prev, voiceHopMs: clamp(Math.round(voiceHopMs), VOICE_HOP_MIN, VOICE_HOP_MAX) }; writeThrough(next); return next; });
  }, [writeThrough]);
  const setVoiceContextMs = useCallback((voiceContextMs: number) => {
    setPersisted(prev => { const next = { ...prev, voiceContextMs: clamp(Math.round(voiceContextMs), VOICE_CONTEXT_MIN, VOICE_CONTEXT_MAX) }; writeThrough(next); return next; });
  }, [writeThrough]);
  const setVoiceAdaptive = useCallback((voiceAdaptive: boolean) => {
    setPersisted(prev => { const next = { ...prev, voiceAdaptive }; writeThrough(next); return next; });
  }, [writeThrough]);
  const setVoiceUseGpu = useCallback((voiceUseGpu: boolean) => {
    setPersisted(prev => { const next = { ...prev, voiceUseGpu }; writeThrough(next); return next; });
  }, [writeThrough]);

  // ── Saved documents (quick-load slots, max 4) ──
  const importDocument = useCallback(async (file: File) => {
    // Parse first (may throw — surfaced by the caller) so a failed read never
    // clobbers the current script or a saved slot.
    const text = await extractTextFromFile(file);
    const name = file.name.replace(/\.[^./\\]+$/, '');
    setPersisted(prev => {
      const documents = [makeDoc(name, text), ...prev.documents].slice(0, MAX_DOCS);
      const next = { ...prev, documents, script: text }; // save AND load
      writeThrough(next); return next;
    });
  }, [writeThrough]);

  const loadDocument = useCallback((id: string) => {
    setPersisted(prev => {
      const doc = prev.documents.find(d => d.id === id);
      if (!doc) return prev;
      const next = { ...prev, script: doc.text };
      writeThrough(next); return next;
    });
  }, [writeThrough]);

  const removeDocument = useCallback((id: string) => {
    setPersisted(prev => {
      const next = { ...prev, documents: prev.documents.filter(d => d.id !== id) };
      writeThrough(next); return next;
    });
  }, [writeThrough]);

  const saveCurrentDocument = useCallback((name?: string) => {
    setPersisted(prev => {
      if (!prev.script.trim()) return prev;
      const label = name ?? prev.script.trim().split('\n', 1)[0];
      const documents = [makeDoc(label, prev.script), ...prev.documents].slice(0, MAX_DOCS);
      const next = { ...prev, documents };
      writeThrough(next); return next;
    });
  }, [writeThrough]);

  // ── Session-only state (not persisted) ──
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<TeleprompterStatus>('idle');
  const [wordIndex, setWordIndex] = useState(0);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [engine, setEngine] = useState<TeleprompterEngine>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [modelProgress, setModelProgress] = useState(0);
  const [listening, setListening] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micLabel, setMicLabel] = useState<string | null>(null);
  const [voiceStats, setVoiceStats] = useState<WhisperStats | null>(null);

  const words = useMemo(() => tokenizeScript(persisted.script), [persisted.script]);
  const scriptNorms = useMemo(() => words.map(w => w.norm), [words]);

  // Whether the browser's built-in Web Speech API is present. Note: Brave ships
  // the constructor but disables the backend (it never returns results), so it
  // is detected separately and routed to the on-device Whisper engine instead.
  const webSpeechPresent = useMemo(
    () => typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition),
    [],
  );
  const isBraveRef = useRef(false);
  useEffect(() => {
    const brave = (navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } }).brave;
    if (brave?.isBrave) { void brave.isBrave().then(v => { isBraveRef.current = !!v; }); }
  }, []);

  // Voice follow is available if either engine can run. The on-device engine
  // needs Web Workers (present in every target browser), so it's the universal
  // path; `speechError` is only set once EVERYTHING has failed → auto-scroll.
  const speechSupported = true;
  const mode: TeleprompterMode = speechError ? 'auto' : 'speech';

  // ── SpeechRecognition machinery ──
  // The pointer lives in a ref: recognition transcript indices reset after
  // every auto-restart, so we can't derive position from the event alone.
  const pointerRef = useRef(0);
  const recRef = useRef<SpeechRecognition | null>(null);
  const activeRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const whisperRef = useRef<WhisperEngine | null>(null);
  const gotResultRef = useRef(false);            // any engine produced a match yet
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest normalized script available to the recognition callbacks
  // without re-creating the recognizer on every keystroke.
  const scriptNormsRef = useRef(scriptNorms);
  useEffect(() => { scriptNormsRef.current = scriptNorms; }, [scriptNorms]);

  // Push voice-follow tuning to the running engine whenever the dials change.
  // No-op until the engine exists; startWhisper also applies it at launch.
  useEffect(() => {
    whisperRef.current?.setTuning(persisted.voiceContextMs / 1000, persisted.voiceHopMs / 1000);
  }, [persisted.voiceContextMs, persisted.voiceHopMs]);
  useEffect(() => {
    whisperRef.current?.setAdaptive(persisted.voiceAdaptive);
  }, [persisted.voiceAdaptive]);
  // GPU toggle hot-swaps the worker (brief model reload) when running.
  useEffect(() => {
    whisperRef.current?.setPreferWebGPU(persisted.voiceUseGpu);
  }, [persisted.voiceUseGpu]);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
  }, []);

  // Shared word-advance: normalize spoken words and nudge the pointer forward.
  // Used by both the Web Speech and Whisper engines.
  const feedSpoken = useCallback((rawWords: string[]) => {
    const norm = rawWords.map(normalizeWord).filter(Boolean);
    if (norm.length === 0) return;
    gotResultRef.current = true;
    // Walk the transcript in small chunks, advancing the pointer after each,
    // rather than matching only the last few words: a long catch-up
    // transcription (Whisper running behind real-time) would otherwise put the
    // tail beyond the matcher's lookahead and never advance at all.
    let next = pointerRef.current;
    for (let i = 0; i < norm.length; i += 5) {
      next = matchTranscript(scriptNormsRef.current, next, norm.slice(i, i + 5));
    }
    if (next !== pointerRef.current) {
      pointerRef.current = next;
      setWordIndex(next);
    }
  }, []);

  const safeStart = useCallback((rec: SpeechRecognition) => {
    // start() throws InvalidStateError if the recognizer is already running.
    try { rec.start(); } catch { /* already started — ignore */ }
  }, []);

  const startSpeech = useCallback(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return false;

    // Drop any previous recognizer so we never end up with two capturing at once.
    clearRestartTimer();
    if (recRef.current) { try { recRef.current.abort(); } catch { /* gone */ } }

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';

    rec.onresult = (e: SREvent) => {
      // Collect words from this event onward and advance the pointer.
      const spoken: string[] = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0]?.transcript ?? '';
        for (const t of text.trim().split(/\s+/)) if (t) spoken.push(t);
      }
      feedSpoken(spoken);
    };

    rec.onend = () => {
      // Chrome auto-stops after ~60s and on network hiccups; restart while
      // we're still meant to be listening.
      if (activeRef.current) {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          if (activeRef.current && recRef.current) safeStart(recRef.current);
        }, 300);
      }
    };

    rec.onerror = (e: SRErrorEvent) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // Permanent: the mic is blocked. Fall back to auto-scroll.
        activeRef.current = false;
        clearRestartTimer();
        setSpeechError('Microphone blocked — using auto-scroll.');
        toast({
          title: 'Voice follow unavailable',
          description: 'Microphone access was blocked. Switched to auto-scroll.',
          variant: 'destructive',
        });
        try { rec.stop(); } catch { /* already stopped */ }
      }
      // no-speech / network / aborted are transient — onend will restart.
    };

    recRef.current = rec;
    activeRef.current = true;
    safeStart(rec);
    setListening(true);
    return true;
  }, [clearRestartTimer, safeStart, toast, feedSpoken]);

  const stopSpeech = useCallback(() => {
    activeRef.current = false;
    clearRestartTimer();
    const rec = recRef.current;
    if (rec) { try { rec.stop(); } catch { /* already stopped */ } }
  }, [clearRestartTimer]);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  }, []);

  // ── On-device Whisper engine (Brave / Safari / Firefox, or Web Speech fallback) ──
  const startWhisper = useCallback(() => {
    setEngine('whisper');
    setModelStatus('loading');
    setModelProgress(0);
    if (!whisperRef.current) whisperRef.current = new WhisperEngine();
    setVoiceStats(null);
    // Apply the persisted latency/accuracy dials + modes before the audio loop starts.
    whisperRef.current.setTuning(persisted.voiceContextMs / 1000, persisted.voiceHopMs / 1000);
    whisperRef.current.setAdaptive(persisted.voiceAdaptive);
    whisperRef.current.setPreferWebGPU(persisted.voiceUseGpu);
    // Use the same microphone selected in AV Settings (persisted by the studio
    // as `studio-mic-id`). Read at start time; a later change is picked up live
    // via the MIC_CHANGED_EVENT listener below (no Stop/Start needed).
    let micId: string | null = null;
    try { micId = localStorage.getItem('studio-mic-id'); } catch { /* ignore */ }
    void whisperRef.current.start({
      onText: (text) => feedSpoken(text.split(/\s+/)),
      onLevel: (level) => setMicLevel(level),
      onMic: (label) => setMicLabel(label),
      onStats: (stats) => setVoiceStats(stats),
      onStatus: (s: WhisperStatus, detail) => {
        if (s === 'loading') { setModelStatus('loading'); if (detail?.progress != null) setModelProgress(detail.progress); }
        else if (s === 'ready') { setModelStatus('ready'); setListening(true); }
        else if (s === 'error') {
          // Everything on-device failed too — degrade to auto-scroll so the
          // teleprompter still moves, and surface the actual reason (truncated)
          // so the failure is diagnosable rather than silent.
          setModelStatus('error');
          setListening(false);
          const raw = (detail?.error ?? '').replace(/\s+/g, ' ').trim();
          const short = raw.length > 160 ? raw.slice(0, 160) + '…' : raw;
          setSpeechError(
            'On-device voice recognition unavailable — using auto-scroll.'
            + (short ? ` Reason: ${short}` : ''),
          );
          console.error('Whisper engine error:', detail?.error);
        }
      },
    }, micId);
  }, [feedSpoken, persisted.voiceContextMs, persisted.voiceHopMs, persisted.voiceAdaptive, persisted.voiceUseGpu]);

  const stopWhisper = useCallback(() => {
    whisperRef.current?.stop();
    setModelStatus(prev => (prev === 'loading' ? 'idle' : prev));
  }, []);

  const start = useCallback(() => {
    setStatus('running');
    setVisible(true);
    setSpeechError(null);   // re-attempt cleanly (e.g. after a dismissed prompt)
    gotResultRef.current = false;
    clearWatchdog();

    // Chrome/Edge: use the built-in engine (light, instant). Brave ships the
    // API but disabled its backend, so route Brave — and anything without the
    // API (Safari/Firefox) — to the on-device Whisper engine.
    const useWebSpeech = webSpeechPresent && !isBraveRef.current;
    if (useWebSpeech) {
      setEngine('webspeech');
      startSpeech();
      // Safety net: if the built-in engine produces nothing within a few
      // seconds (a silently-broken backend, as in Brave), switch to Whisper.
      watchdogRef.current = setTimeout(() => {
        if (!gotResultRef.current) {
          stopSpeech();
          setListening(false);
          startWhisper();
        }
      }, 5000);
    } else {
      startWhisper();
    }
  }, [webSpeechPresent, startSpeech, stopSpeech, startWhisper, clearWatchdog]);

  const pause = useCallback(() => {
    setStatus('paused');
    setListening(false);
    setMicLevel(0);
    clearWatchdog();
    stopSpeech();
    stopWhisper();
  }, [stopSpeech, stopWhisper, clearWatchdog]);

  const reset = useCallback(() => {
    setListening(false);
    setMicLevel(0);
    clearWatchdog();
    stopSpeech();
    stopWhisper();
    pointerRef.current = 0;
    setWordIndex(0);
    setStatus('idle');
  }, [stopSpeech, stopWhisper, clearWatchdog]);

  // Editing the script invalidates the pointer — snap back to the start.
  useEffect(() => {
    pointerRef.current = 0;
    setWordIndex(0);
  }, [persisted.script]);

  // Live mic switching: when AV Settings changes the microphone, move the
  // running voice engine to it without a Stop/Start. Only the on-device Whisper
  // engine can be re-targeted — Web Speech (Chrome/Edge) captures the OS default
  // mic and ignores device selection, so there's nothing to switch there.
  useEffect(() => {
    const onMicChanged = () => {
      let micId: string | null = null;
      try { micId = localStorage.getItem('studio-mic-id'); } catch { /* ignore */ }
      void whisperRef.current?.switchMic(micId);
    };
    window.addEventListener(MIC_CHANGED_EVENT, onMicChanged);
    return () => window.removeEventListener(MIC_CHANGED_EVENT, onMicChanged);
  }, []);

  // Unmount: abort recognition outright (abort() skips the final onend restart)
  // and fully release the Whisper worker.
  useEffect(() => () => {
    activeRef.current = false;
    clearRestartTimer();
    clearWatchdog();
    const rec = recRef.current;
    if (rec) { try { rec.abort(); } catch { /* gone */ } }
    whisperRef.current?.dispose();
    whisperRef.current = null;
  }, [clearRestartTimer, clearWatchdog]);

  const value: TeleprompterContextType = {
    script: persisted.script,
    setScript,
    visible,
    setVisible,
    opacity: persisted.opacity,
    setOpacity,
    fontSize: persisted.fontSize,
    setFontSize,
    scrollSpeed: persisted.scrollSpeed,
    setScrollSpeed,
    speechSupported,
    speechError,
    mode,
    status,
    wordIndex,
    words,
    start,
    pause,
    reset,
    engine,
    modelStatus,
    modelProgress,
    listening,
    micLevel,
    micLabel,
    voiceHopMs: persisted.voiceHopMs,
    setVoiceHopMs,
    voiceContextMs: persisted.voiceContextMs,
    setVoiceContextMs,
    voiceAdaptive: persisted.voiceAdaptive,
    setVoiceAdaptive,
    voiceUseGpu: persisted.voiceUseGpu,
    setVoiceUseGpu,
    voiceStats,
    documents: persisted.documents,
    importDocument,
    loadDocument,
    removeDocument,
    saveCurrentDocument,
  };

  return <TeleprompterContext.Provider value={value}>{children}</TeleprompterContext.Provider>;
}

export function useTeleprompter() {
  const ctx = useContext(TeleprompterContext);
  if (!ctx) throw new Error('useTeleprompter must be used within TeleprompterProvider');
  return ctx;
}
