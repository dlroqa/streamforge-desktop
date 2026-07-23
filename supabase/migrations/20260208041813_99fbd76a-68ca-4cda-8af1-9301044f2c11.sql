
-- Create scheduled_streams table
CREATE TABLE public.scheduled_streams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  platforms TEXT[] NOT NULL DEFAULT '{}',
  recording_id UUID REFERENCES public.recordings(id) ON DELETE SET NULL,
  recording_title TEXT,
  record_on_stream BOOLEAN NOT NULL DEFAULT false,
  record_save_mode TEXT CHECK (record_save_mode IN ('local', 'cloud')) DEFAULT 'cloud',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  session_id UUID REFERENCES public.stream_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scheduled_streams ENABLE ROW LEVEL SECURITY;

-- Users can only see their own scheduled streams
CREATE POLICY "Users can view own scheduled streams"
  ON public.scheduled_streams FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own scheduled streams"
  ON public.scheduled_streams FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scheduled streams"
  ON public.scheduled_streams FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own scheduled streams"
  ON public.scheduled_streams FOR DELETE
  USING (auth.uid() = user_id);

-- Service role needs full access for the cron trigger
CREATE POLICY "Service role full access on scheduled_streams"
  ON public.scheduled_streams FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for the cron job to find pending streams due to start
CREATE INDEX idx_scheduled_streams_pending ON public.scheduled_streams (scheduled_at)
  WHERE status = 'pending';

-- Timestamp trigger
CREATE TRIGGER update_scheduled_streams_updated_at
  BEFORE UPDATE ON public.scheduled_streams
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
