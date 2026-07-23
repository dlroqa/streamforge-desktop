-- Make user_id NOT NULL on stream_destinations to prevent orphaned records
ALTER TABLE public.stream_destinations
  ALTER COLUMN user_id SET NOT NULL;

-- Also make user_id NOT NULL on stream_sessions for consistency
ALTER TABLE public.stream_sessions
  ALTER COLUMN user_id SET NOT NULL;
