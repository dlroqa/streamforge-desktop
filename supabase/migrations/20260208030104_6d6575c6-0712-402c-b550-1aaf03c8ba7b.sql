
-- Ensure RLS is enabled on _encryption_config
ALTER TABLE public._encryption_config ENABLE ROW LEVEL SECURITY;

-- Remove any existing policies
DROP POLICY IF EXISTS "Service role only" ON public._encryption_config;

-- Block ALL access via the API (no permissive policies = no access for anon/authenticated)
-- Only service_role bypasses RLS, which is exactly what we want.
-- Add an explicit deny-all policy as defense-in-depth:
CREATE POLICY "No public access"
  ON public._encryption_config
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Revoke direct table privileges from public roles as an extra layer
REVOKE ALL ON public._encryption_config FROM anon, authenticated;
