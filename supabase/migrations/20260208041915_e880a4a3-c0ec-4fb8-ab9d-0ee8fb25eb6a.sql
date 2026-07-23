
-- Remove overly permissive service role policy (service_role bypasses RLS by default)
DROP POLICY IF EXISTS "Service role full access on scheduled_streams" ON public.scheduled_streams;
