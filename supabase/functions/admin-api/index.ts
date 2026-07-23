// Admin API — backs the hidden /ed/admin panel.
//
// Auth model: NOT Supabase auth. The admin logs in with a username/password
// held in admin_accounts (bcrypt). Success mints an opaque bearer token
// (returned once, stored hashed in admin_sessions, 8h expiry) that the panel
// sends back as `x-admin-token`. The default seeded password is unusable
// beyond changing it: while must_change_password is set, every other action
// is rejected. Five failed logins lock the account for 15 minutes.
import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token",
};

const SESSION_HOURS = 8;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD_LEN = 10;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number) {
  return json(status, { success: false, error: message });
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    const action = body.action;

    // ── login ──
    if (action === "login") {
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!username || !password) return errorResponse("Missing credentials", 400);

      const { data: account } = await supabase
        .from("admin_accounts").select("*").eq("username", username).maybeSingle();

      // Same error for unknown user and bad password — don't leak which.
      const badCredentials = () => errorResponse("Invalid username or password", 401);
      if (!account) {
        await bcrypt.compare(password, "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZnfHqPqXqXqXqXqXqXqXqXqXqXqXqX")
          .catch(() => false); // burn comparable time
        return badCredentials();
      }

      if (account.locked_until && new Date(account.locked_until) > new Date()) {
        return errorResponse("Too many failed attempts. Try again later.", 429);
      }

      const ok = await bcrypt.compare(password, account.password_hash);
      if (!ok) {
        const failed = (account.failed_attempts ?? 0) + 1;
        await supabase.from("admin_accounts").update({
          failed_attempts: failed >= MAX_FAILED ? 0 : failed,
          locked_until: failed >= MAX_FAILED
            ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
            : null,
        }).eq("id", account.id);
        return badCredentials();
      }

      const token = newToken();
      await supabase.from("admin_sessions").insert({
        account_id: account.id,
        token_hash: await sha256Hex(token),
        expires_at: new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString(),
      });
      // Housekeeping: clear expired sessions and the failure counter.
      await supabase.from("admin_sessions").delete().lt("expires_at", new Date().toISOString());
      await supabase.from("admin_accounts")
        .update({ failed_attempts: 0, locked_until: null }).eq("id", account.id);

      return json(200, {
        success: true,
        token,
        mustChangePassword: account.must_change_password === true,
      });
    }

    // ── Everything else requires a valid session ──
    const rawToken = req.headers.get("x-admin-token") ?? "";
    if (!/^[0-9a-f]{64}$/.test(rawToken)) return errorResponse("Not signed in", 401);
    const { data: session } = await supabase
      .from("admin_sessions")
      .select("id, account_id, expires_at")
      .eq("token_hash", await sha256Hex(rawToken))
      .maybeSingle();
    if (!session || new Date(session.expires_at) <= new Date()) {
      return errorResponse("Session expired — sign in again", 401);
    }
    const { data: account } = await supabase
      .from("admin_accounts").select("*").eq("id", session.account_id).single();
    if (!account) return errorResponse("Not signed in", 401);

    if (action === "logout") {
      await supabase.from("admin_sessions").delete().eq("id", session.id);
      return json(200, { success: true });
    }

    // ── change_password (the only action allowed while the default stands) ──
    if (action === "change_password") {
      const current = typeof body.current_password === "string" ? body.current_password : "";
      const next = typeof body.new_password === "string" ? body.new_password : "";
      if (!(await bcrypt.compare(current, account.password_hash))) {
        return errorResponse("Current password is incorrect", 401);
      }
      if (next.length < MIN_PASSWORD_LEN) {
        return errorResponse(`New password must be at least ${MIN_PASSWORD_LEN} characters`, 400);
      }
      if (next === current || next.toLowerCase() === "password" || next === account.username) {
        return errorResponse("Choose a stronger password", 400);
      }
      await supabase.from("admin_accounts").update({
        password_hash: await bcrypt.hash(next, 10),
        must_change_password: false,
        updated_at: new Date().toISOString(),
      }).eq("id", account.id);
      // Rotating the password invalidates every other session.
      await supabase.from("admin_sessions")
        .delete().eq("account_id", account.id).neq("id", session.id);
      return json(200, { success: true });
    }

    if (account.must_change_password) {
      return errorResponse("You must change the default password first", 403);
    }

    // ── list_users ──
    if (action === "list_users") {
      const users: unknown[] = [];
      for (let page = 1; page <= 10; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return errorResponse(error.message, 500);
        for (const u of data.users) {
          // banned_until is present in the API payload but missing from the
          // supabase-js User type.
          const banned = (u as unknown as { banned_until?: string }).banned_until;
          users.push({
            id: u.id,
            email: u.email ?? null,
            createdAt: u.created_at,
            lastSignInAt: u.last_sign_in_at ?? null,
            providers: (u.app_metadata?.providers as string[] | undefined)
              ?? (u.app_metadata?.provider ? [u.app_metadata.provider] : []),
            blocked: !!banned && new Date(banned) > new Date(),
          });
        }
        if (data.users.length < 200) break;
      }
      return json(200, { success: true, users });
    }

    // ── user_activity ──
    if (action === "user_activity") {
      if (!UUID_REGEX.test(String(body.user_id))) return errorResponse("Invalid user id", 400);
      const { data, error } = await supabase
        .from("user_activity")
        .select("area, at")
        .eq("user_id", body.user_id)
        .order("at", { ascending: false })
        .limit(5);
      if (error) return errorResponse(error.message, 500);
      return json(200, { success: true, activities: data });
    }

    // ── set_blocked ──
    if (action === "set_blocked") {
      if (!UUID_REGEX.test(String(body.user_id))) return errorResponse("Invalid user id", 400);
      const blocked = body.blocked === true;
      // Supabase ban: blocks new sign-ins AND token refresh, so it also cuts
      // off OAuth users; live sessions end at the next refresh (≤1h).
      const { error } = await supabase.auth.admin.updateUserById(String(body.user_id), {
        ban_duration: blocked ? "87600h" : "none", // ~10 years / lift
      });
      if (error) return errorResponse(error.message, 500);
      return json(200, { success: true, blocked });
    }

    return errorResponse("Unknown action", 400);
  } catch (err) {
    console.error("admin-api error:", err);
    return errorResponse("Internal error", 500);
  }
});
