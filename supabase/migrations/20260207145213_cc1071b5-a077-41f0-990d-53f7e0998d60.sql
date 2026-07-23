-- Add Mux-specific columns to stream_sessions
ALTER TABLE public.stream_sessions
ADD COLUMN IF NOT EXISTS mux_stream_id text,
ADD COLUMN IF NOT EXISTS mux_playback_id text;

-- Index for quick lookup of active Mux streams
CREATE INDEX IF NOT EXISTS idx_stream_sessions_mux_stream_id ON public.stream_sessions (mux_stream_id) WHERE mux_stream_id IS NOT NULL;
