import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlatformViewerCount {
  platform: string;
  name: string;
  viewers: number | null;
  error?: string;
}

export interface ViewerAnalyticsData {
  totalViewers: number;
  platforms: PlatformViewerCount[];
}

const POLL_INTERVAL_MS = 15_000; // 15 seconds

export function useViewerAnalytics() {
  const [data, setData] = useState<ViewerAnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  const fetchViewers = useCallback(async () => {
    try {
      const { data: result, error } = await supabase.functions.invoke('viewer-analytics');
      if (error) {
        if (import.meta.env.DEV) console.error('Viewer analytics error:', error);
        return;
      }
      if (result?.success) {
        setData({
          totalViewers: result.total_viewers ?? 0,
          platforms: result.platforms ?? [],
        });
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Viewer analytics fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    setLoading(true);
    fetchViewers(); // immediate first fetch
    intervalRef.current = setInterval(fetchViewers, POLL_INTERVAL_MS);
  }, [fetchViewers]);

  const stopPolling = useCallback(() => {
    activeRef.current = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setData(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    viewerData: data,
    viewerLoading: loading,
    startViewerPolling: startPolling,
    stopViewerPolling: stopPolling,
  };
}
