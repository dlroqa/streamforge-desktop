-- Add Mux Space/Broadcast tracking to stream sessions
ALTER TABLE public.stream_sessions 
ADD COLUMN mux_space_id text,
ADD COLUMN mux_broadcast_id text;