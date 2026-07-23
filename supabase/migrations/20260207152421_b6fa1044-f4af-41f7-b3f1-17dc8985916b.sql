
-- =============================================
-- Fix RLS policies for stream_destinations
-- =============================================

-- Drop all existing policies on stream_destinations
DROP POLICY IF EXISTS "Service role full access on destinations" ON public.stream_destinations;
DROP POLICY IF EXISTS "Users can delete own destinations" ON public.stream_destinations;
DROP POLICY IF EXISTS "Users can insert own destinations" ON public.stream_destinations;
DROP POLICY IF EXISTS "Users can update own destinations" ON public.stream_destinations;
DROP POLICY IF EXISTS "Users can view own destinations" ON public.stream_destinations;

-- Recreate as PERMISSIVE policies scoped to authenticated users
CREATE POLICY "Users can view own destinations"
  ON public.stream_destinations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own destinations"
  ON public.stream_destinations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own destinations"
  ON public.stream_destinations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own destinations"
  ON public.stream_destinations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =============================================
-- Fix RLS policies for stream_sessions
-- =============================================

-- Drop all existing policies on stream_sessions
DROP POLICY IF EXISTS "Service role full access on sessions" ON public.stream_sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.stream_sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON public.stream_sessions;
DROP POLICY IF EXISTS "Users can view own sessions" ON public.stream_sessions;

-- Recreate as PERMISSIVE policies scoped to authenticated users
CREATE POLICY "Users can view own sessions"
  ON public.stream_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON public.stream_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON public.stream_sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add the missing DELETE policy for stream_sessions
CREATE POLICY "Users can delete own sessions"
  ON public.stream_sessions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
