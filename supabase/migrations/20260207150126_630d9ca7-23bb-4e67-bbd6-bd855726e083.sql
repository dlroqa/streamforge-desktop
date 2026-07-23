-- Add user_id to stream_destinations
ALTER TABLE public.stream_destinations
ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to stream_sessions
ALTER TABLE public.stream_sessions
ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop old permissive policies on stream_destinations
DROP POLICY IF EXISTS "Allow all delete on stream_destinations" ON public.stream_destinations;
DROP POLICY IF EXISTS "Allow all insert on stream_destinations" ON public.stream_destinations;
DROP POLICY IF EXISTS "Allow all read on stream_destinations" ON public.stream_destinations;
DROP POLICY IF EXISTS "Allow all update on stream_destinations" ON public.stream_destinations;

-- New user-scoped policies for stream_destinations
CREATE POLICY "Users can view own destinations"
  ON public.stream_destinations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own destinations"
  ON public.stream_destinations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own destinations"
  ON public.stream_destinations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own destinations"
  ON public.stream_destinations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow service role full access for edge functions
CREATE POLICY "Service role full access on destinations"
  ON public.stream_destinations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Drop old permissive policies on stream_sessions
DROP POLICY IF EXISTS "Allow all insert on stream_sessions" ON public.stream_sessions;
DROP POLICY IF EXISTS "Allow all read on stream_sessions" ON public.stream_sessions;
DROP POLICY IF EXISTS "Allow all update on stream_sessions" ON public.stream_sessions;

-- New user-scoped policies for stream_sessions
CREATE POLICY "Users can view own sessions"
  ON public.stream_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON public.stream_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON public.stream_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow service role full access for edge functions
CREATE POLICY "Service role full access on sessions"
  ON public.stream_sessions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
