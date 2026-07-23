
-- Drop the security definer view (resolves linter + RLS-on-view issue)
DROP VIEW IF EXISTS public.stream_destinations_safe;

-- Create a security definer function to return user's destinations without stream_key
-- Security definer functions are the recommended pattern (used for has_role, etc.)
CREATE OR REPLACE FUNCTION public.get_user_destinations()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  user_id uuid,
  enabled boolean,
  platform text,
  name text,
  stream_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, created_at, updated_at, user_id, enabled, platform, name, stream_url
  FROM public.stream_destinations
  WHERE user_id = auth.uid();
$$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.get_user_destinations() FROM public;
REVOKE ALL ON FUNCTION public.get_user_destinations() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_destinations() TO authenticated;
