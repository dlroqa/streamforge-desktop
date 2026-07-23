import { createClient } from "npm:@supabase/supabase-js@2";

// PUBLIC edge function (verify_jwt = false, no Authorization required). Guests
// have no account; the opaque invite_token in the /guest/:token link is the
// capability. This resolves that token to a Daily room URL + a fresh non-owner
// meeting token so the branded guest studio can join headlessly.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_BASE = "https://api.daily.co/v1";
// Guest tokens are short-lived relative to the 6h room; a guest joins now.
const GUEST_TOKEN_TTL_SECONDS = 6 * 60 * 60;

async function dailyRequest(path: string, method: string, body?: unknown) {
  const apiKey = Deno.env.get("DAILY_API_KEY");
  if (!apiKey) throw new Error("Daily.co API key not configured");
  const options: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`${DAILY_API_BASE}${path}`, options);
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  const data = JSON.parse(text);
  if (!response.ok) {
    console.error(`Daily API error: ${response.status} - ${JSON.stringify(data)}`);
    throw new Error(`Daily service error (${response.status})`);
  }
  return data;
}

function errorResponse(message: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid request body", 400);
    }
    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", 400);
    }

    const { action, invite_token } = body as Record<string, unknown>;
    if (action !== "resolve") {
      return errorResponse("Invalid action", 400);
    }
    if (typeof invite_token !== "string" || invite_token.length < 16 || invite_token.length > 128) {
      return errorResponse("Invalid invite token", 400);
    }

    // Look up the invite (service role bypasses RLS).
    const { data: invite } = await supabase
      .from("guest_invites")
      .select("daily_room_name, guest_name, status, expires_at, host_user_id")
      .eq("invite_token", invite_token)
      .maybeSingle();

    if (!invite) {
      return errorResponse("This invite link is not valid.", 404);
    }
    if (invite.status === "revoked") {
      return errorResponse("This invite has been revoked.", 410);
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return errorResponse("This invite link has expired.", 410);
    }

    // Determine the stream's current phase from the host's session for this room.
    const { data: session } = await supabase
      .from("stream_sessions")
      .select("title, status")
      .eq("daily_room_name", invite.daily_room_name)
      .eq("user_id", invite.host_user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const streamStatus: "live" | "preparing" | "ended" =
      session?.status === "live" ? "live"
      : session?.status === "preparing" ? "preparing"
      : "ended";

    // Best-effort host label for the "guest of {host}" header. Prefer the
    // account's editable display name, then the email's local part, then the
    // full email — so guests see the name the host set in Account settings.
    let hostName = "the host";
    try {
      const { data: hostUser } = await supabase.auth.admin.getUserById(invite.host_user_id);
      const meta = hostUser?.user?.user_metadata as { display_name?: unknown } | undefined;
      const displayName = typeof meta?.display_name === "string" ? meta.display_name.trim() : "";
      const email = hostUser?.user?.email ?? "";
      hostName = displayName || email.split("@")[0] || email || hostName;
    } catch { /* non-fatal */ }

    // If the room is gone the stream has ended — no token to mint.
    let room: { url?: string } | null = null;
    try {
      room = await dailyRequest(`/rooms/${invite.daily_room_name}`, "GET");
    } catch {
      room = null;
    }
    if (!room?.url) {
      return new Response(
        JSON.stringify({
          success: true,
          status: "ended",
          guest_name: invite.guest_name || "Guest",
          host_name: hostName,
          stream_title: session?.title || null,
          room_url: null,
          daily_token: null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fresh non-owner meeting token for this guest.
    const tokenRes = await dailyRequest("/meeting-tokens", "POST", {
      properties: {
        room_name: invite.daily_room_name,
        is_owner: false,
        user_name: invite.guest_name || "Guest",
        exp: Math.floor(Date.now() / 1000) + GUEST_TOKEN_TTL_SECONDS,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        status: streamStatus,
        room_url: room.url,
        daily_token: tokenRes.token,
        guest_name: invite.guest_name || "Guest",
        host_name: hostName,
        stream_title: session?.title || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("guest-access error:", error);
    return errorResponse("Could not resolve invite. Please try again.", 500);
  }
});
