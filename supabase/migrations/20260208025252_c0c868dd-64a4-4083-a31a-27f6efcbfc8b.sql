
-- Drop the existing RESTRICTIVE SELECT policy on stream_sessions
DROP POLICY IF EXISTS "Users can view own sessions" ON public.stream_sessions;

-- Create a proper PERMISSIVE SELECT policy that requires authentication
CREATE POLICY "Users can view own sessions"
  ON public.stream_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
