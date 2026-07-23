
-- Add platform_channel_id to store the platform-specific identifier
-- (e.g., Twitch username, YouTube channel ID, Facebook page ID)
-- needed for API lookups of viewer counts
ALTER TABLE public.stream_destinations
ADD COLUMN platform_channel_id TEXT;

COMMENT ON COLUMN public.stream_destinations.platform_channel_id IS 'Platform-specific identifier for API lookups (Twitch username, YouTube channel ID, Facebook page ID)';
