-- Guest invites: shareable links that let a remote guest join the host's
-- Daily room and appear as a second video source on the broadcast.
-- Rows are created/read/updated by the stream-manager & guest-access edge
-- functions (service_role); the host can also read/revoke their own invites.
CREATE TABLE public.guest_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  host_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Opaque capability token embedded in the branded /guest/:token link
  invite_token TEXT NOT NULL UNIQUE,
  -- Daily room the guest joins (shared with the host's stream session)
  daily_room_name TEXT NOT NULL,
  guest_name TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'joined', 'revoked')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_guest_invites_token ON public.guest_invites (invite_token);
CREATE INDEX idx_guest_invites_host ON public.guest_invites (host_user_id);

ALTER TABLE public.guest_invites ENABLE ROW LEVEL SECURITY;

-- Host can see and revoke their own invites (the guest-join flow itself runs
-- through the service role in edge functions, so no anon policy is needed).
CREATE POLICY "Users can view own invites"
  ON public.guest_invites FOR SELECT
  USING (auth.uid() = host_user_id);

CREATE POLICY "Users can update own invites"
  ON public.guest_invites FOR UPDATE
  USING (auth.uid() = host_user_id)
  WITH CHECK (auth.uid() = host_user_id);

CREATE POLICY "Service role full access on invites"
  ON public.guest_invites FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
