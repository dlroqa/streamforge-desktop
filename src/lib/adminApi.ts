/**
 * Client for the admin-api edge function behind the hidden /ed/admin panel.
 *
 * Sessions are opaque bearer tokens minted by the function at login, held in
 * sessionStorage (cleared when the tab closes) and sent as `x-admin-token`.
 * This is deliberately separate from Supabase auth — the admin is not a
 * platform user.
 */
import { supabase } from '@/integrations/supabase/client';

const TOKEN_KEY = 'sf-admin-token';

export interface AdminUser {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  providers: string[];
  blocked: boolean;
}

export interface AdminActivity {
  area: string;
  at: string;
}

export function getAdminToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setAdminToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

/** Thrown on a 401 so the UI can drop back to the login screen. */
export class AdminAuthError extends Error {}

async function call<T>(body: Record<string, unknown>, withToken = true): Promise<T> {
  const token = getAdminToken();
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body,
    headers: withToken && token ? { 'x-admin-token': token } : undefined,
  });
  if (error) {
    // FunctionsHttpError carries the response; surface the server's message.
    const res = (error as { context?: Response }).context;
    let message = 'Request failed';
    let status = 0;
    if (res instanceof Response) {
      status = res.status;
      message = (await res.json().catch(() => null))?.error ?? message;
    }
    if (status === 401) { setAdminToken(null); throw new AdminAuthError(message); }
    throw new Error(message);
  }
  const payload = data as { success: boolean; error?: string } & T;
  if (!payload?.success) throw new Error(payload?.error ?? 'Request failed');
  return payload;
}

export async function adminLogin(username: string, password: string): Promise<{ mustChangePassword: boolean }> {
  const { token, mustChangePassword } =
    await call<{ token: string; mustChangePassword: boolean }>({ action: 'login', username, password }, false);
  setAdminToken(token);
  return { mustChangePassword };
}

export async function adminLogout(): Promise<void> {
  try { await call({ action: 'logout' }); } catch { /* session dies server-side on expiry anyway */ }
  setAdminToken(null);
}

export async function adminChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  await call({ action: 'change_password', current_password: currentPassword, new_password: newPassword });
}

export async function adminListUsers(): Promise<AdminUser[]> {
  return (await call<{ users: AdminUser[] }>({ action: 'list_users' })).users;
}

export async function adminUserActivity(userId: string): Promise<AdminActivity[]> {
  return (await call<{ activities: AdminActivity[] }>({ action: 'user_activity', user_id: userId })).activities;
}

export async function adminSetBlocked(userId: string, blocked: boolean): Promise<void> {
  await call({ action: 'set_blocked', user_id: userId, blocked });
}
