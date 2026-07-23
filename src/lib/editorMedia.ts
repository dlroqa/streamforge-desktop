import { useCallback, useRef } from 'react';
import { openLocalRecording } from '@/lib/localRecordings';
import type { Recording } from '@/hooks/useRecordings';

/**
 * Resolves a recording id to a playable object URL (cloud signed URL or local
 * file blob), caching the result for the session. Shared by the preview
 * compositor and the exporter.
 */
export function useMediaResolver(
  recordings: Recording[],
  getCloudUrl: (path: string) => Promise<string | null>,
) {
  const cache = useRef(new Map<string, string>());

  return useCallback(async (recordingId: string): Promise<string | null> => {
    const cached = cache.current.get(recordingId);
    if (cached) return cached;

    const rec = recordings.find(r => r.id === recordingId);
    if (!rec) return null;

    let url: string | null = null;
    if (rec.storage_type === 'cloud' && rec.storage_path) {
      url = await getCloudUrl(rec.storage_path);
    } else if (rec.storage_type === 'local') {
      const result = await openLocalRecording(rec.id);
      url = result.ok ? result.url : null;
    }
    if (url) cache.current.set(recordingId, url);
    return url;
  }, [recordings, getCloudUrl]);
}

/** Load a media file's duration (seconds) by probing its metadata. */
export function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = url;
    const done = (d: number) => { v.src = ''; resolve(Number.isFinite(d) ? d : 0); };
    v.onloadedmetadata = () => done(v.duration);
    v.onerror = () => done(0);
  });
}
