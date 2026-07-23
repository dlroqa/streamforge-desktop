import { createClient } from "npm:@supabase/supabase-js@2";

// Google Drive OAuth — exchanges/refreshes a user's Google Drive tokens so the
// studio can store their recordings, edited videos and graphics in their OWN
// Drive. Tokens are returned to the browser (stored client-side only); the
// client SECRET lives only here. Reuses the same Google OAuth app as YouTube
// (GOOGLE_OAUTH_CLIENT_ID/SECRET) — its consent screen must include the
// `drive.file` scope, and `/oauth/callback` is already an authorized redirect.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// Per-file scope: the app only ever sees files it created — least privilege,
// and (unlike broader Drive scopes) not subject to Google's security review.
const SCOPE = "https://www.googleapis.com/auth/drive.file";

function creds(): { id: string; secret: string } | null {
  const id = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const secret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  return id && secret ? { id, secret } : null;
}

// Only accept an https/http redirect back to our own callback path.
function validRedirect(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.pathname !== "/oauth/callback") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function errorResponse(message: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function ok(body: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ success: true, ...body }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// Shared by exchange (code) and refresh (refresh_token). Google only returns a
// refresh_token on the initial exchange, so refresh responses omit it — the
// client keeps the one it already has.
async function tokenRequest(params: Record<string, string>) {
  const c = creds()!;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      ...params,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    console.error("google-drive token request failed:", res.status, JSON.stringify(data));
    throw new Error("Could not complete sign-in with Google Drive. Please try again.");
  }
  return ok({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ── Auth (same pattern as freesound-auth / platform-connect) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Authentication required", 401);
    }
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: authError } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !claimsData?.claims) {
      return errorResponse("Invalid or expired token", 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid request body", 400);
    }
    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", 400);
    }
    const { action, ...payload } = body as Record<string, unknown>;

    if (action === "providers") {
      return ok({ configured: !!creds() });
    }

    if (action === "authorize-url") {
      const redirectUri = validRedirect(payload.redirect_uri);
      if (!redirectUri) return errorResponse("Invalid redirect URI", 400);
      const state = typeof payload.state === "string" ? payload.state.slice(0, 128) : "";
      if (!state) return errorResponse("Missing state", 400);
      const c = creds();
      if (!c) return errorResponse("Google Drive isn't configured yet.", 400);

      const params = new URLSearchParams({
        client_id: c.id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPE,
        // Offline + a forced consent prompt guarantee we receive a refresh token
        // so the connection survives past the ~1h access-token lifetime.
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
      });
      return ok({ url: `${AUTHORIZE_URL}?${params.toString()}` });
    }

    if (action === "exchange") {
      const redirectUri = validRedirect(payload.redirect_uri);
      if (!redirectUri) return errorResponse("Invalid redirect URI", 400);
      const code = typeof payload.code === "string" ? payload.code : "";
      if (!code) return errorResponse("Missing authorization code", 400);
      if (!creds()) return errorResponse("Google Drive isn't configured yet.", 400);
      return await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });
    }

    if (action === "refresh") {
      const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
      if (!refreshToken) return errorResponse("Missing refresh token", 400);
      if (!creds()) return errorResponse("Google Drive isn't configured yet.", 400);
      return await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    }

    return errorResponse("Invalid action", 400);
  } catch (error) {
    console.error("google-drive-auth error:", error);
    const message = error instanceof Error ? error.message : "Unable to connect Google Drive.";
    return errorResponse(message, 400);
  }
});
