
-- 1. Enable pgcrypto for symmetric encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Create a locked-down table for the encryption passphrase
CREATE TABLE IF NOT EXISTS public._encryption_config (
  id TEXT PRIMARY KEY DEFAULT 'stream_key_passphrase',
  passphrase TEXT NOT NULL
);
ALTER TABLE public._encryption_config ENABLE ROW LEVEL SECURITY;
-- Zero policies = zero client access; only SECURITY DEFINER functions can read

-- 3. Generate and store a random 256-bit encryption passphrase
INSERT INTO public._encryption_config (id, passphrase)
VALUES ('stream_key_passphrase', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- 4. Trigger function: auto-encrypt stream_key on INSERT / UPDATE
CREATE OR REPLACE FUNCTION public._encrypt_stream_key_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pp TEXT;
BEGIN
  -- Only encrypt if value is plain text (not already encrypted)
  IF NEW.stream_key IS NOT NULL AND NEW.stream_key NOT LIKE 'ENC:%' THEN
    SELECT ec.passphrase INTO pp
    FROM public._encryption_config ec
    WHERE ec.id = 'stream_key_passphrase';

    NEW.stream_key := 'ENC:' || encode(extensions.pgp_sym_encrypt(NEW.stream_key, pp), 'base64');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER encrypt_stream_key_on_write
BEFORE INSERT OR UPDATE OF stream_key ON public.stream_destinations
FOR EACH ROW
EXECUTE FUNCTION public._encrypt_stream_key_trigger();

-- 5. Encrypt any existing plain-text keys (trigger fires on UPDATE)
DO $$
DECLARE
  r RECORD;
  pp TEXT;
BEGIN
  SELECT ec.passphrase INTO pp
  FROM public._encryption_config ec
  WHERE ec.id = 'stream_key_passphrase';

  FOR r IN SELECT id, stream_key FROM public.stream_destinations WHERE stream_key NOT LIKE 'ENC:%'
  LOOP
    UPDATE public.stream_destinations
    SET stream_key = 'ENC:' || encode(extensions.pgp_sym_encrypt(r.stream_key, pp), 'base64')
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- 6. Server-side-only function to decrypt keys (for edge functions)
CREATE OR REPLACE FUNCTION public.get_decrypted_destinations(p_user_id UUID)
RETURNS TABLE(
  id UUID, stream_url TEXT, stream_key TEXT, name TEXT, platform TEXT, enabled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pp TEXT;
BEGIN
  -- Only allow service_role callers (edge functions)
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT ec.passphrase INTO pp
  FROM public._encryption_config ec
  WHERE ec.id = 'stream_key_passphrase';

  RETURN QUERY
  SELECT
    sd.id, sd.stream_url,
    extensions.pgp_sym_decrypt(decode(substring(sd.stream_key from 5), 'base64'), pp) AS stream_key,
    sd.name, sd.platform, sd.enabled
  FROM public.stream_destinations sd
  WHERE sd.user_id = p_user_id;
END;
$$;
