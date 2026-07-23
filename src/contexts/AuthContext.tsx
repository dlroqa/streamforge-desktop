import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { trackActivity } from '@/lib/userActivity';
import { runCloudMigration } from '@/lib/cloudMigrate';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /** Update the account's editable display name (stored in user metadata). */
  updateDisplayName: (name: string) => Promise<{ error: Error | null }>;
  /** Persist the studio sidebar's menu order for this account (user metadata),
   * so the arrangement follows the user across devices. */
  updateSidebarOrder: (order: string[]) => Promise<{ error: Error | null }>;
  /** Choose where new files are stored: Supabase (default) or the user's own
   * Google Drive. Kept in user metadata so it follows the account. */
  updateStorageBackend: (backend: 'supabase' | 'drive') => Promise<{ error: Error | null }>;
}

/** The account's editable display name, falling back to the email's local part
 * so every user has a sensible default before they set one. */
export function displayNameOf(user: User | null): string {
  const meta = user?.user_metadata as { display_name?: unknown } | undefined;
  const name = typeof meta?.display_name === 'string' ? meta.display_name.trim() : '';
  if (name) return name;
  return user?.email?.split('@')[0] ?? '';
}

/** The account's saved studio sidebar order (menu ids, top→bottom), or null if
 * the user hasn't customised it yet. Stale/removed ids are tolerated by the
 * sidebar, which merges this against the current menu set. */
export function sidebarOrderOf(user: User | null): string[] | null {
  const meta = user?.user_metadata as { sidebar_order?: unknown } | undefined;
  const raw = meta?.sidebar_order;
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((x): x is string => typeof x === 'string');
  return ids.length ? ids : null;
}

/** The account's chosen storage backend for new files ('supabase' default). */
export function storageBackendOf(user: User | null): 'supabase' | 'drive' {
  const meta = user?.user_metadata as { storage_backend?: unknown } | undefined;
  return meta?.storage_backend === 'drive' ? 'drive' : 'supabase';
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      if (event === 'SIGNED_IN') {
        trackActivity('Sign in');
        // One-time backfill of any pre-cloud local media for this device.
        void runCloudMigration();
      }
    });

    // Then check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) void runCloudMigration();
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error ? new Error(error.message) : null };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const updateDisplayName = useCallback(async (name: string) => {
    const { data, error } = await supabase.auth.updateUser({
      data: { display_name: name.trim() },
    });
    // updateUser also emits USER_UPDATED (handled by the listener), but set the
    // fresh user immediately so the UI reflects the change without waiting.
    if (!error && data.user) setUser(data.user);
    return { error: error ? new Error(error.message) : null };
  }, []);

  const updateSidebarOrder = useCallback(async (order: string[]) => {
    const { data, error } = await supabase.auth.updateUser({
      data: { sidebar_order: order },
    });
    // Reflect immediately (USER_UPDATED also fires) so the order sticks locally
    // even before the round-trip settles.
    if (!error && data.user) setUser(data.user);
    return { error: error ? new Error(error.message) : null };
  }, []);

  const updateStorageBackend = useCallback(async (backend: 'supabase' | 'drive') => {
    const { data, error } = await supabase.auth.updateUser({
      data: { storage_backend: backend },
    });
    // Reflect immediately (USER_UPDATED also fires) so the choice sticks locally
    // even before the round-trip settles.
    if (!error && data.user) setUser(data.user);
    return { error: error ? new Error(error.message) : null };
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut, updateDisplayName, updateSidebarOrder, updateStorageBackend }}>
      {children}
    </AuthContext.Provider>
  );
}
