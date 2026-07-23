
-- Stream destinations: persist platform configurations
CREATE TABLE public.stream_destinations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  stream_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.stream_destinations ENABLE ROW LEVEL SECURITY;

-- Permissive for now (no auth yet) - should be scoped to user when auth is added
CREATE POLICY "Allow all read on stream_destinations"
  ON public.stream_destinations FOR SELECT USING (true);
CREATE POLICY "Allow all insert on stream_destinations"
  ON public.stream_destinations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on stream_destinations"
  ON public.stream_destinations FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on stream_destinations"
  ON public.stream_destinations FOR DELETE USING (true);

-- Stream sessions: track live/recording history
CREATE TABLE public.stream_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  destination_ids UUID[] DEFAULT '{}',
  recording_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.stream_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read on stream_sessions"
  ON public.stream_sessions FOR SELECT USING (true);
CREATE POLICY "Allow all insert on stream_sessions"
  ON public.stream_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on stream_sessions"
  ON public.stream_sessions FOR UPDATE USING (true) WITH CHECK (true);

-- Enable realtime for stream sessions
ALTER PUBLICATION supabase_realtime ADD TABLE public.stream_sessions;

-- Trigger for updated_at on destinations
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_stream_destinations_updated_at
  BEFORE UPDATE ON public.stream_destinations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
