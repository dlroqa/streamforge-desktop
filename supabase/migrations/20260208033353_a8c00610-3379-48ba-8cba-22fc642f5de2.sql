
-- Create a service-role-only function to list destinations without stream keys
CREATE OR REPLACE FUNCTION public.get_user_destinations_by_id(p_user_id uuid)
RETURNS TABLE(id uuid, created_at timestamptz, updated_at timestamptz, user_id uuid, enabled boolean, platform text, name text, stream_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only allow service_role callers (edge functions)
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT sd.id, sd.created_at, sd.updated_at, sd.user_id, sd.enabled, sd.platform, sd.name, sd.stream_url
  FROM public.stream_destinations sd
  WHERE sd.user_id = p_user_id;
END;
$$;
