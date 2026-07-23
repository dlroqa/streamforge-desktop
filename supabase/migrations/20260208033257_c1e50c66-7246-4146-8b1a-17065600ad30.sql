
-- Drop the trigger first (correct name)
DROP TRIGGER IF EXISTS encrypt_stream_key_on_write ON public.stream_destinations;

-- Now drop the function
DROP FUNCTION IF EXISTS public._encrypt_stream_key_trigger();

-- Drop the _encryption_config table
DROP TABLE IF EXISTS public._encryption_config;
