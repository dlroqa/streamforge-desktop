import { createClient } from "npm:@supabase/supabase-js@2";

// Freesound OAuth — exchanges/refreshes the user's Freesound tokens so the
// editor's Sound Fx browser can search and download effects. Tokens are
// returned to the browser (stored client-side only); the client SECRET lives
// only here. Freesound pins the callback URL on the API credential itself, so
// no redirect_uri flows through this function.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUTHORIZE_URL = "https://freesound.org/apiv2/oauth2/authorize/";
const TOKEN_URL = "https://freesound.org/apiv2/oauth2/access_token/";

function creds(): { id: string; secret: string } | null {
  const id = Deno.env.get("FREESOUND_CLIENT_ID");
  const secret = Deno.env.get("FREESOUND_CLIENT_SECRET");
  return id && secret ? { id, secret } : null;
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

// Shared by exchange (code) and refresh (refresh_token).
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
    console.error("freesound token request failed:", res.status, JSON.stringify(data));
    throw new Error("Could not complete sign-in with Freesound. Please try again.");
  }
  return ok({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
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

    // ── Auth (same pattern as platform-connect) ──
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
      const state = typeof payload.state === "string" ? payload.state.slice(0, 128) : "";
      if (!state) return errorResponse("Missing state", 400);
      const c = creds();
      if (!c) return errorResponse("Freesound isn't configured yet.", 400);

      const params = new URLSearchParams({
        client_id: c.id,
        response_type: "code",
        state,
      });
      return ok({ url: `${AUTHORIZE_URL}?${params.toString()}` });
    }

    if (action === "exchange") {
      const code = typeof payload.code === "string" ? payload.code : "";
      if (!code) return errorResponse("Missing authorization code", 400);
      if (!creds()) return errorResponse("Freesound isn't configured yet.", 400);
      return await tokenRequest({ grant_type: "authorization_code", code });
    }

    if (action === "refresh") {
      const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
      if (!refreshToken) return errorResponse("Missing refresh token", 400);
      if (!creds()) return errorResponse("Freesound isn't configured yet.", 400);
      return await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    }

    return errorResponse("Invalid action", 400);
  } catch (error) {
    console.error("freesound-auth error:", error);
    const message = error instanceof Error ? error.message : "Unable to connect Freesound.";
    return errorResponse(message, 400);
  }
});
