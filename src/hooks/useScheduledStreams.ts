import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface ScheduledStream {
  id: string;
  title: string;
  scheduled_at: string;
  platforms: string[];
  recording_id: string | null;
  recording_title: string | null;
  record_on_stream: boolean;
  record_save_mode: string | null;
  status: string;
  created_at: string;
}

export function useScheduledStreams() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [scheduledStreams, setScheduledStreams] = useState<ScheduledStream[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = session?.user?.id;

  const fetchStreams = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('scheduled_streams')
      .select('*')
      .order('scheduled_at', { ascending: true });

    if (error) {
      if (import.meta.env.DEV) console.error('Fetch scheduled streams error:', error);
      return;
    }
    setScheduledStreams(data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchStreams();
  }, [fetchStreams]);

  const addScheduledStream = useCallback(async (stream: {
    title: string;
    scheduled_at: string;
    platforms: string[];
    recording_id?: string;
    recording_title?: string;
    record_on_stream: boolean;
    record_save_mode?: string;
  }) => {
    if (!userId) return;

    const { data, error } = await supabase
      .from('scheduled_streams')
      .insert({
        user_id: userId,
        title: stream.title,
        scheduled_at: stream.scheduled_at,
        platforms: stream.platforms,
        recording_id: stream.recording_id || null,
        recording_title: stream.recording_title || null,
        record_on_stream: stream.record_on_stream,
        record_save_mode: stream.record_on_stream ? (stream.record_save_mode || 'cloud') : null,
      })
      .select()
      .single();

    if (error) {
      toast({
        title: 'Failed to schedule stream',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    if (data) {
      setScheduledStreams(prev => [...prev, data].sort(
        (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      ));
      toast({ title: 'Stream scheduled', description: `"${stream.title}" scheduled successfully.` });
    }
  }, [userId, toast]);

  const removeScheduledStream = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('scheduled_streams')
      .delete()
      .eq('id', id);

    if (error) {
      toast({
        title: 'Failed to remove schedule',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setScheduledStreams(prev => prev.filter(s => s.id !== id));
  }, [toast]);

  return {
    scheduledStreams,
    loading,
    addScheduledStream,
    removeScheduledStream,
    refetch: fetchStreams,
  };
}
