
-- Fix stream_destinations SELECT policy: drop the restrictive one and create a permissive one scoped to authenticated users
DROP POLICY IF EXISTS "Users can view own destinations" ON public.stream_destinations;

CREATE POLICY "Users can view own destinations"
  ON public.stream_destinations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
