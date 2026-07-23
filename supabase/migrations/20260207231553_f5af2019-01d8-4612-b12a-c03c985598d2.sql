
-- Drop unused legacy Mux columns from stream_sessions
ALTER TABLE public.stream_sessions DROP COLUMN IF EXISTS mux_stream_id;
ALTER TABLE public.stream_sessions DROP COLUMN IF EXISTS mux_playback_id;
ALTER TABLE public.stream_sessions DROP COLUMN IF EXISTS mux_broadcast_id;

-- Rename mux_space_id to daily_room_name (it stores the Daily.co room name)
ALTER TABLE public.stream_sessions RENAME COLUMN mux_space_id TO daily_room_name;
