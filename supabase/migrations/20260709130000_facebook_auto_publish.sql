-- Facebook auto-publish streaming (Option B)
--
-- Persist a long-lived Facebook Page access token per destination so that going
-- live can mint a fresh LIVE_NOW broadcast automatically (no per-session setup).
--   * provider_token       — encrypted ('enc:' + pgp) FB Page access token
--   * provider_account_id  — FB Page id (plaintext; not secret)
-- stream_sessions.provider_broadcasts records the live videos created at go-live
-- so `stop` can end them.

ALTER TABLE public.stream_destinations
  ADD COLUMN IF NOT EXISTS provider_token text,
  ADD COLUMN IF NOT EXISTS provider_account_id text;

ALTER TABLE public.stream_sessions
  ADD COLUMN IF NOT EXISTS provider_broadcasts jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Drop the previous signatures so the new defaulted params don't create an
-- ambiguous overload, and so the widened RETURNS TABLE is accepted.
DROP FUNCTION IF EXISTS public.insert_destination_encrypted(uuid, text, text, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.update_destination_encrypted(uuid, uuid, text, text, text, text, text);

-- ── insert_destination_encrypted: also encrypt/store the provider token + id ──
-- New params are defaulted so existing 7-arg named calls still resolve here.
CREATE OR REPLACE FUNCTION public.insert_destination_encrypted(
  p_user_id uuid,
  p_platform text,
  p_name text,
  p_stream_key text,
  p_stream_url text,
  p_enabled boolean,
  p_passphrase text,
  p_provider_token text DEFAULT NULL,
  p_provider_account_id text DEFAULT NULL
)
RETURNS TABLE(id uuid, created_at timestamptz, updated_at timestamptz, user_id uuid, enabled boolean, platform text, name text, stream_url text, platform_channel_id text, provider_account_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  encrypted_key TEXT;
  encrypted_token TEXT;
BEGIN
  encrypted_key := 'enc:' || encode(extensions.pgp_sym_encrypt(p_stream_key, p_passphrase)::bytea, 'base64');
  IF p_provider_token IS NOT NULL AND p_provider_token <> '' THEN
    encrypted_token := 'enc:' || encode(extensions.pgp_sym_encrypt(p_provider_token, p_passphrase)::bytea, 'base64');
  ELSE
    encrypted_token := NULL;
  END IF;

  RETURN QUERY
  INSERT INTO public.stream_destinations (user_id, platform, name, stream_key, stream_url, enabled, provider_token, provider_account_id)
  VALUES (p_user_id, p_platform, p_name, encrypted_key, p_stream_url, p_enabled, encrypted_token, NULLIF(p_provider_account_id, ''))
  RETURNING
    stream_destinations.id,
    stream_destinations.created_at,
    stream_destinations.updated_at,
    stream_destinations.user_id,
    stream_destinations.enabled,
    stream_destinations.platform,
    stream_destinations.name,
    stream_destinations.stream_url,
    stream_destinations.platform_channel_id,
    stream_destinations.provider_account_id;
END;
$function$;

-- ── update_destination_encrypted: keep-existing-when-blank for token too ──
CREATE OR REPLACE FUNCTION public.update_destination_encrypted(
  p_id uuid,
  p_user_id uuid,
  p_name text,
  p_stream_url text,
  p_platform_channel_id text,
  p_stream_key text,
  p_passphrase text,
  p_provider_token text DEFAULT NULL,
  p_provider_account_id text DEFAULT NULL
)
RETURNS TABLE(id uuid, created_at timestamptz, updated_at timestamptz, user_id uuid, enabled boolean, platform text, name text, stream_url text, platform_channel_id text, provider_account_id text)
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
    provider_token = CASE
      WHEN p_provider_token IS NOT NULL AND p_provider_token <> ''
        THEN 'enc:' || encode(extensions.pgp_sym_encrypt(p_provider_token, p_passphrase)::bytea, 'base64')
      ELSE sd.provider_token
    END,
    provider_account_id = COALESCE(NULLIF(p_provider_account_id, ''), sd.provider_account_id),
    updated_at = now()
  WHERE sd.id = p_id AND sd.user_id = p_user_id;

  RETURN QUERY
  SELECT sd.id, sd.created_at, sd.updated_at, sd.user_id, sd.enabled, sd.platform, sd.name, sd.stream_url, sd.platform_channel_id, sd.provider_account_id
  FROM public.stream_destinations sd
  WHERE sd.id = p_id AND sd.user_id = p_user_id;
END;
$function$;

-- ── get_decrypted_destinations: also return the decrypted token + page id ──
DROP FUNCTION IF EXISTS public.get_decrypted_destinations(uuid, text);
CREATE OR REPLACE FUNCTION public.get_decrypted_destinations(p_user_id uuid, p_passphrase text DEFAULT NULL)
 RETURNS TABLE(id uuid, stream_url text, stream_key text, name text, platform text, enabled boolean, provider_token text, provider_account_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_passphrase IS NULL OR p_passphrase = '' THEN
    RAISE EXCEPTION 'Passphrase is required';
  END IF;

  RETURN QUERY
  SELECT
    sd.id, sd.stream_url,
    extensions.pgp_sym_decrypt(decode(substring(sd.stream_key from 5), 'base64'), p_passphrase) AS stream_key,
    sd.name, sd.platform, sd.enabled,
    CASE
      WHEN sd.provider_token IS NOT NULL AND sd.provider_token LIKE 'enc:%'
        THEN extensions.pgp_sym_decrypt(decode(substring(sd.provider_token from 5), 'base64'), p_passphrase)
      ELSE NULL
    END AS provider_token,
    sd.provider_account_id
  FROM public.stream_destinations sd
  WHERE sd.user_id = p_user_id;
END;
$function$;

-- ── get_user_destinations_by_id: expose provider_account_id so the client list
-- (and the Auto-post badge) survives a reload. Token stays server-side. ──
DROP FUNCTION IF EXISTS public.get_user_destinations_by_id(uuid);
CREATE OR REPLACE FUNCTION public.get_user_destinations_by_id(p_user_id uuid)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, user_id uuid, enabled boolean, platform text, name text, stream_url text, platform_channel_id text, provider_account_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT sd.id, sd.created_at, sd.updated_at, sd.user_id, sd.enabled, sd.platform, sd.name, sd.stream_url, sd.platform_channel_id, sd.provider_account_id
  FROM public.stream_destinations sd
  WHERE sd.user_id = p_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_user_destinations_by_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_destinations_by_id(uuid) TO service_role;

-- Re-apply EXECUTE privileges (service_role only) for the new signatures.
REVOKE EXECUTE ON FUNCTION public.insert_destination_encrypted(uuid, text, text, text, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_destination_encrypted(uuid, text, text, text, text, boolean, text, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_destination_encrypted(uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_destination_encrypted(uuid, uuid, text, text, text, text, text, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_decrypted_destinations(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_decrypted_destinations(uuid, text) TO service_role;
