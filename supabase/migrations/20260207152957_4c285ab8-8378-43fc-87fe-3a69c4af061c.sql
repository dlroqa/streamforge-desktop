
-- Create a safe view that excludes stream_key for client-side reads
CREATE VIEW public.stream_destinations_safe
AS
  SELECT id, created_at, updated_at, user_id, enabled, platform, name, stream_url
  FROM public.stream_destinations
  WHERE user_id = auth.uid();

-- Grant access to the view for authenticated users
GRANT SELECT ON public.stream_destinations_safe TO authenticated;

-- Deny direct SELECT on the base table for authenticated users
-- (service_role bypasses RLS entirely so edge functions still work)
DROP POLICY IF EXISTS "Users can view own destinations" ON public.stream_destinations;
CREATE POLICY "No direct read access to destinations"
  ON public.stream_destinations
  FOR SELECT
  TO authenticated
  USING (false);
