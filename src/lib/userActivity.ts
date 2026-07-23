/**
 * Server-side activity trail: records which work area the signed-in user
 * opened (Studio, Video Editor, sidebar panels, …) into the user_activity
 * table. The admin panel reads the last few entries per user. Best-effort —
 * failures never surface to the user.
 */
import { supabase } from '@/integrations/supabase/client';

/** Skip repeat hits on the same area within this window (per page load). */
const DEDUPE_MS = 60_000;
const lastSent = new Map<string, number>();

export function trackActivity(area: string): void {
  const now = Date.now();
  if ((lastSent.get(area) ?? 0) > now - DEDUPE_MS) return;
  lastSent.set(area, now);

  void (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('user_activity').insert({ user_id: user.id, area });
    } catch {
      /* activity logging is non-critical */
    }
  })();
}
