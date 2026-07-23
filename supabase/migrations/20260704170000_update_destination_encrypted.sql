-- Edit support for stream destinations:
-- 1. update_destination_encrypted: updates name/url/channel id and, when a
--    new stream key is provided, re-encrypts it server-side. Blank/NULL key
--    keeps the existing encrypted key (keys are never sent back to clients).
-- 2. get_user_destinations_by_id gains platform_channel_id so the client
--    list shows channel IDs after reload (it was silently dropped before).

CREATE OR REPLACE FUNCTION public.update_destination_encrypted(
  p_id uuid,
  p_user_id uuid,
  p_name text,
  p_stream_url text,
  p_platform_channel_id text,
  p_stream_key text,
  p_passphrase text
)
RETURNS TABLE(id uuid, created_at timestamptz, updated_at timestamptz, user_id uuid, enabled boolean, platform text, name text, stream_url text, platform_channel_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.stream_destinations sd
  SET
    name = COALESCE(NULLIF(p_name, ''), sd.name),
    stream_url = COALESCE(NULLIF(p_stream_url, ''), sd.stream_url),
    platform_channel_id = NULLIF(p_platform_channel_id, ''),
    stream_key = CASE
      WHEN p_stream_key IS NOT NULL AND p_stream_key <> ''
        THEN 'enc:' || encode(extensions.pgp_sym_encrypt(p_stream_key, p_passphrase)::bytea, 'base64')
      ELSE sd.stream_key
    END,
    updated_at = now()
  WHERE sd.id = p_id AND sd.user_id = p_user_id;

  RETURN QUERY
  SELECT sd.id, sd.created_at, sd.updated_at, sd.user_id, sd.enabled, sd.platform, sd.name, sd.stream_url, sd.platform_channel_id
  FROM public.stream_destinations sd
  WHERE sd.id = p_id AND sd.user_id = p_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_destination_encrypted(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_destination_encrypted(uuid, uuid, text, text, text, text, text) TO service_role;

-- Include platform_channel_id in the list RPC
DROP FUNCTION IF EXISTS public.get_user_destinations_by_id(uuid);
CREATE OR REPLACE FUNCTION public.get_user_destinations_by_id(p_user_id uuid)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, user_id uuid, enabled boolean, platform text, name text, stream_url text, platform_channel_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT sd.id, sd.created_at, sd.updated_at, sd.user_id, sd.enabled, sd.platform, sd.name, sd.stream_url, sd.platform_channel_id
  FROM public.stream_destinations sd
  WHERE sd.user_id = p_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_user_destinations_by_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_destinations_by_id(uuid) TO service_role;
