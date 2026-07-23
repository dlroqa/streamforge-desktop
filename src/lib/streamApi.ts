import { supabase } from '@/integrations/supabase/client';

export interface StreamResponse {
  success: boolean;
  session_id?: string;
  destinations_count?: number;
  message?: string;
  error?: string;
  daily_room_url?: string;
  daily_token?: string;
  daily_rtmp_endpoints?: string[];
}

export async function startStream(title?: string): Promise<StreamResponse> {
  const { data, error } = await supabase.functions.invoke('stream-manager', {
    body: { action: 'start', title: title || 'Live Stream' },
  });

  if (error) {
    if (import.meta.env.DEV) console.error('Start stream error:', error);
    return { success: false, error: error.message };
  }

  return data as StreamResponse;
}

/**
 * Enter the waiting room (backstage) without going live: ensures a private
 * Daily room exists (reusing the one go-live will promote) and returns an owner
 * token so the host can join, see/hear waiting guests, and prep — no RTMP. Going
 * live afterwards reuses the same room, so guests never reconnect.
 */
export async function prepareRoom(): Promise<StreamResponse> {
  const { data, error } = await supabase.functions.invoke('stream-manager', {
    body: { action: 'prepare' },
  });

  if (error) {
    if (import.meta.env.DEV) console.error('Prepare room error:', error);
    return { success: false, error: error.message };
  }

  return data as StreamResponse;
}

export async function stopStream(sessionId?: string): Promise<StreamResponse> {
  const { data, error } = await supabase.functions.invoke('stream-manager', {
    body: { action: 'stop', session_id: sessionId },
  });

  if (error) {
    if (import.meta.env.DEV) console.error('Stop stream error:', error);
    return { success: false, error: error.message };
  }

  return data as StreamResponse;
}

export interface GuestInviteResponse {
  success: boolean;
  join_url?: string;
  guest_name?: string;
  /** Whether an invite email was actually sent (false when no email given or delivery failed) */
  emailed?: boolean;
  error?: string;
}

export async function createGuestInvite(opts?: { guestName?: string; email?: string }): Promise<GuestInviteResponse> {
  const { data, error } = await supabase.functions.invoke('stream-manager', {
    body: {
      action: 'guest-token',
      guest_name: opts?.guestName,
      email: opts?.email,
      // The branded /guest/:token link is built from the host's app origin.
      app_origin: window.location.origin,
    },
  });

  if (error) {
    if (import.meta.env.DEV) console.error('Guest invite error:', error);
    return { success: false, error: error.message };
  }

  return data as GuestInviteResponse;
}

export interface GuestAccessResponse {
  success: boolean;
  status?: 'live' | 'preparing' | 'ended';
  room_url?: string | null;
  daily_token?: string | null;
  guest_name?: string;
  host_name?: string;
  stream_title?: string | null;
  error?: string;
}

/** Resolve a guest invite token to a Daily room + guest token (public — no auth). */
export async function resolveGuestInvite(inviteToken: string): Promise<GuestAccessResponse> {
  const { data, error } = await supabase.functions.invoke('guest-access', {
    body: { action: 'resolve', invite_token: inviteToken },
  });

  if (error) {
    if (import.meta.env.DEV) console.error('Guest access error:', error);
    // Edge functions return a JSON error body with a friendly message on 4xx.
    const ctx = (error as { context?: { error?: string } })?.context;
    return { success: false, error: ctx?.error || error.message };
  }

  return data as GuestAccessResponse;
}

export interface StreamSessionSummary {
  id: string;
  title: string;
  status: string;
  started_at: string;
  destination_ids: string[];
}

export async function getStreamStatus(): Promise<{
  success: boolean;
  is_live: boolean;
  sessions: StreamSessionSummary[];
}> {
  const { data, error } = await supabase.functions.invoke('stream-manager', {
    body: { action: 'status' },
  });

  if (error) {
    return { success: false, is_live: false, sessions: [] };
  }

  return data;
}
