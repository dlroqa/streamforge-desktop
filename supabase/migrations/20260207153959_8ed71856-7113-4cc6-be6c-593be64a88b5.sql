
-- Replace the restrictive "block all reads" policy with a proper permissive user-scoped SELECT
DROP POLICY IF EXISTS "No direct read access to destinations" ON public.stream_destinations;

CREATE POLICY "Users can view own destinations"
  ON public.stream_destinations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
