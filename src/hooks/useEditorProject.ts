import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  type EditorProject, type EditorClip, type EditorOverlay, type EditorAudioClip,
  createEmptyProject, normalizeProject, appendClip, reflowClips, splitClip,
  splitAudioClip, splitOverlay, splitAllAt,
  updateClipById, addOverlay, updateOverlayById, removeOverlayById,
  makeTextOverlay, makeImageOverlay, makeLowerThirdOverlay,
  makeAudioClip, addAudioClip as addAudioClipToProject, updateAudioClipById, removeAudioClipById,
} from '@/lib/editorProject';

// Local cache is namespaced per user so accounts sharing a browser never see
// (or upsert to the cloud) each other's project. The un-namespaced legacy key
// is only read by the one-time cloud migration, never here.
const storageKey = (userId: string) => `streamforge-editor-project:${userId}`;

function parseProject(raw: string | null): EditorProject | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as EditorProject;
    if (p?.version === 1 && Array.isArray(p.clips)) return normalizeProject(p);
  } catch { /* malformed cache */ }
  return null;
}

/**
 * Editor project state with localStorage autosave and undo/redo history.
 * `update` takes a producer that returns the next project; it pushes the
 * previous state onto the undo stack.
 */
export function useEditorProject() {
  const [project, setProjectState] = useState<EditorProject>(createEmptyProject);
  const undoStack = useRef<EditorProject[]>([]);
  const redoStack = useRef<EditorProject[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Cloud sync: the project lives in the per-user `editor_projects` row so it
  // follows the user across devices. localStorage is kept as an instant,
  // offline cache. `hydratedRef` gates cloud writes until we've loaded the
  // server copy; `editedRef` prevents a late cloud load from clobbering edits
  // the user already started this session.
  const userIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const editedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      userIdRef.current = user?.id ?? null;
      if (user) {
        // Instant offline copy from this user's own cache…
        const local = parseProject(localStorage.getItem(storageKey(user.id)));
        if (local && !editedRef.current) setProjectState(local);
        // …then the authoritative cloud copy.
        const { data } = await supabase
          .from('editor_projects').select('project').eq('user_id', user.id).maybeSingle();
        const cloud = (data as { project?: EditorProject } | null)?.project;
        if (!cancelled && cloud && !editedRef.current
            && cloud.version === 1 && Array.isArray(cloud.clips)) {
          setProjectState(normalizeProject(cloud));
        }
      }
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // Autosave: local cache immediately; cloud upsert debounced (only once the
  // cloud copy has been hydrated, so we don't overwrite it with the placeholder).
  useEffect(() => {
    const uid = userIdRef.current;
    if (uid) {
      try { localStorage.setItem(storageKey(uid), JSON.stringify(project)); } catch { /* quota */ }
    }
    if (!hydratedRef.current || !uid) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void supabase.from('editor_projects').upsert(
        { user_id: uid, project: project as never } as never,
        { onConflict: 'user_id' },
      );
    }, 800);
  }, [project]);

  const syncFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  /** Apply a change and record history. */
  const update = useCallback((producer: (p: EditorProject) => EditorProject) => {
    setProjectState(prev => {
      const next = producer(prev);
      if (next === prev) return prev;
      editedRef.current = true;
      undoStack.current.push(prev);
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
      syncFlags();
      return next;
    });
  }, [syncFlags]);

  /** Apply a change WITHOUT recording history — for continuous drags (trim,
   * reorder). Pair with `beginHistory()` captured at drag start + `commitHistory`. */
  const setProjectTransient = useCallback((producer: (p: EditorProject) => EditorProject) => {
    editedRef.current = true;
    setProjectState(producer);
  }, []);

  /** Push a pre-drag snapshot onto the undo stack (call once when a drag ends). */
  const commitHistory = useCallback((before: EditorProject) => {
    undoStack.current.push(before);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    syncFlags();
  }, [syncFlags]);

  const undo = useCallback(() => {
    setProjectState(prev => {
      const last = undoStack.current.pop();
      if (!last) return prev;
      redoStack.current.push(prev);
      syncFlags();
      return last;
    });
  }, [syncFlags]);

  const redo = useCallback(() => {
    setProjectState(prev => {
      const next = redoStack.current.pop();
      if (!next) return prev;
      undoStack.current.push(prev);
      syncFlags();
      return next;
    });
  }, [syncFlags]);

  // ── Common operations ──
  const addRecording = useCallback((rec: { recordingId: string; name: string; sourceDuration: number }): string => {
    const id = crypto.randomUUID();
    update(p => appendClip(p, rec, id));
    return id;
  }, [update]);

  const removeClip = useCallback((clipId: string) => {
    update(p => reflowClips({ ...p, clips: p.clips.filter(c => c.id !== clipId) }));
  }, [update]);

  const splitAt = useCallback((clipId: string, timelineTime: number) => {
    update(p => splitClip(p, clipId, timelineTime));
  }, [update]);

  const splitAudioAt = useCallback((audioId: string, timelineTime: number) => {
    update(p => splitAudioClip(p, audioId, timelineTime));
  }, [update]);

  const splitOverlayAt = useCallback((overlayId: string, timelineTime: number) => {
    update(p => splitOverlay(p, overlayId, timelineTime));
  }, [update]);

  /** Razor every track at a timeline time (single undo step). */
  const splitAllAtTime = useCallback((timelineTime: number) => {
    update(p => splitAllAt(p, timelineTime));
  }, [update]);

  const updateClip = useCallback((clipId: string, patch: Partial<EditorClip>) => {
    update(p => updateClipById(p, clipId, patch));
  }, [update]);

  const addTextOverlay = useCallback((atTime: number): string => {
    const o = makeTextOverlay(atTime);
    update(p => addOverlay(p, o));
    return o.id;
  }, [update]);

  const addLowerThirdOverlay = useCallback((atTime: number): string => {
    const o = makeLowerThirdOverlay(atTime);
    update(p => addOverlay(p, o));
    return o.id;
  }, [update]);

  const addImageOverlay = useCallback((atTime: number, src: string): string => {
    const o = makeImageOverlay(atTime, src);
    update(p => addOverlay(p, o));
    return o.id;
  }, [update]);

  const updateOverlay = useCallback((id: string, patch: Partial<EditorOverlay>) => {
    update(p => updateOverlayById(p, id, patch));
  }, [update]);

  const removeOverlay = useCallback((id: string) => {
    update(p => removeOverlayById(p, id));
  }, [update]);

  const addAudioClip = useCallback((assetId: string, name: string, sourceDuration: number, atTime: number): string => {
    const a = makeAudioClip(assetId, name, sourceDuration, atTime);
    update(p => addAudioClipToProject(p, a));
    return a.id;
  }, [update]);

  const updateAudioClip = useCallback((id: string, patch: Partial<EditorAudioClip>) => {
    update(p => updateAudioClipById(p, id, patch));
  }, [update]);

  const removeAudioClip = useCallback((id: string) => {
    update(p => removeAudioClipById(p, id));
  }, [update]);

  const rename = useCallback((name: string) => {
    update(p => ({ ...p, name }));
  }, [update]);

  const setCanvasSize = useCallback((width: number, height: number) => {
    update(p => ({ ...p, width, height }));
  }, [update]);

  const resetProject = useCallback(() => {
    update(() => createEmptyProject());
  }, [update]);

  return {
    project, update, setProjectTransient, commitHistory,
    undo, redo, canUndo, canRedo,
    addRecording, removeClip, splitAt, splitAudioAt, splitOverlayAt, splitAllAtTime,
    updateClip, rename, resetProject, setCanvasSize,
    addTextOverlay, addLowerThirdOverlay, addImageOverlay, updateOverlay, removeOverlay,
    addAudioClip, updateAudioClip, removeAudioClip,
  };
}
