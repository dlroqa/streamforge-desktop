// UPDATE SYSTEM — one-click config sync, restricted to a single admin account.
//
// The admin (ADMIN_EMAIL) presses "UPDATE SYSTEM" in Account settings. This
// copies the admin's *shared* app settings (everything in their auth
// user_metadata EXCEPT personal/identity keys) onto every other account, so all
// users end up with the same system configuration the admin has.
//
// Deliberately NOT copied:
//   • display_name  — each user keeps their own name.
//   • Uploaded media / graphics — those live in storage + DB rows, never here.
// A user's own settings are preserved for any key the admin hasn't set (merge,
// not replace), so this only ever adds/overwrites the admin's shared keys.
//
// Auth: the caller's Supabase JWT is verified and their email must match
// ADMIN_EMAIL. All writes use the service-role key (server-side only).
import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = "erocaide@gmail.com";

// Personal/identity metadata that must never be propagated between accounts.
const PROTECTED_KEYS = new Set(["display_name"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number) {
  return json(status, { success: false, error: message });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ── Authenticate the caller via their Supabase JWT ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Authentication required", 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: authError } = await userClient.auth.getClaims(token);
    if (authError || !claimsData?.claims?.sub) {
      return errorResponse("Invalid or expired token", 401);
    }
    const callerId = claimsData.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceKey);

    // Authoritative fetch of the caller (fresh email + metadata, not the JWT).
    const { data: callerRes, error: callerErr } = await admin.auth.admin.getUserById(callerId);
    if (callerErr || !callerRes?.user) return errorResponse("Account not found", 401);
    const caller = callerRes.user;

    if ((caller.email ?? "").trim().toLowerCase() !== ADMIN_EMAIL) {
      return errorResponse("Not authorized", 403);
    }

    // ── Build the shared-settings payload from the admin's metadata ──
    const source = (caller.user_metadata ?? {}) as Record<string, unknown>;
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (!PROTECTED_KEYS.has(key)) payload[key] = value;
    }
    const keys = Object.keys(payload);

    // ── Fan the payload out to every other account (merge, not replace) ──
    let updated = 0;
    let scanned = 0;
    let failed = 0;
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return errorResponse(error.message, 500);
      for (const u of data.users) {
        if (u.id === callerId) continue; // don't rewrite the admin's own account
        scanned++;
        if (keys.length === 0) continue; // nothing to sync
        const merged = { ...(u.user_metadata ?? {}), ...payload };
        const { error: upErr } = await admin.auth.admin.updateUserById(u.id, {
          user_metadata: merged,
        });
        if (upErr) { failed++; console.error("sync-system update failed", u.id, upErr.message); }
        else updated++;
      }
      if (data.users.length < 200) break;
    }

    return json(200, { success: true, updated, scanned, failed, keys });
  } catch (err) {
    console.error("sync-system error:", err);
    return errorResponse("Internal error", 500);
  }
});
