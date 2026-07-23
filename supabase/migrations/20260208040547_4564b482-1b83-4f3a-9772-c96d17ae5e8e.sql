
-- Update insert_destination_encrypted to use extensions.pgp_sym_encrypt
CREATE OR REPLACE FUNCTION public.insert_destination_encrypted(
  p_user_id uuid,
  p_platform text,
  p_name text,
  p_stream_key text,
  p_stream_url text,
  p_enabled boolean,
  p_passphrase text
)
RETURNS TABLE(id uuid, created_at timestamptz, updated_at timestamptz, user_id uuid, enabled boolean, platform text, name text, stream_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  encrypted_key TEXT;
BEGIN
  encrypted_key := 'enc:' || encode(extensions.pgp_sym_encrypt(p_stream_key, p_passphrase)::bytea, 'base64');

  RETURN QUERY
  INSERT INTO public.stream_destinations (user_id, platform, name, stream_key, stream_url, enabled)
  VALUES (p_user_id, p_platform, p_name, encrypted_key, p_stream_url, p_enabled)
  RETURNING
    stream_destinations.id,
    stream_destinations.created_at,
    stream_destinations.updated_at,
    stream_destinations.user_id,
    stream_destinations.enabled,
    stream_destinations.platform,
    stream_destinations.name,
    stream_destinations.stream_url;
END;
$function$;

-- Update get_decrypted_destinations to use extensions.pgp_sym_decrypt
CREATE OR REPLACE FUNCTION public.get_decrypted_destinations(p_user_id uuid, p_passphrase text DEFAULT NULL)
 RETURNS TABLE(id uuid, stream_url text, stream_key text, name text, platform text, enabled boolean)
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
    sd.name, sd.platform, sd.enabled
  FROM public.stream_destinations sd
  WHERE sd.user_id = p_user_id;
END;
$function$;

-- Re-apply EXECUTE privileges
REVOKE EXECUTE ON FUNCTION public.insert_destination_encrypted(uuid, text, text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_destination_encrypted(uuid, text, text, text, text, boolean, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_decrypted_destinations(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_decrypted_destinations(uuid, text) TO service_role;
