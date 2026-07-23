import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_BASE = "https://api.daily.co/v1";
const FB_GRAPH = "https://graph.facebook.com/v19.0";

interface DecryptedDestination {
  id: string;
  name: string;
  platform: string;
  enabled: boolean;
  stream_url: string;
  stream_key: string;
  provider_token?: string | null;
  provider_account_id?: string | null;
}

// ── Facebook auto-publish ──
// Create a LIVE_NOW broadcast on the Page; Facebook auto-posts it the moment
// video arrives. secure_stream_url is the full "rtmps://host/rtmp/KEY" endpoint.
async function createFacebookBroadcast(
  pageId: string,
  token: string,
  title: string,
): Promise<{ endpoint: string; liveVideoId: string }> {
  const res = await fetch(`${FB_GRAPH}/${pageId}/live_videos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      status: "LIVE_NOW",
      title: title.slice(0, 255),
      access_token: token,
    }).toString(),
  });
  const live = await res.json().catch(() => ({}));
  const url: string | undefined = live?.secure_stream_url || live?.stream_url;
  if (!res.ok || !url) {
    throw new Error(`Facebook live_videos failed: ${JSON.stringify(live)}`);
  }
  return { endpoint: url, liveVideoId: String(live.id || "") };
}

// Best-effort end of a broadcast on stop. Facebook also auto-ends when the RTMP
// stream drops, so a failure here is non-fatal.
async function endFacebookBroadcast(liveVideoId: string, token: string): Promise<void> {
  try {
    const res = await fetch(`${FB_GRAPH}/${liveVideoId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ end_live_video: "true", access_token: token }).toString(),
    });
    if (!res.ok) {
      console.error(`Facebook end_live_video failed (${liveVideoId}):`, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error(`Facebook end_live_video error (${liveVideoId}):`, err);
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function isValidAction(value: unknown): value is "start" | "stop" | "status" | "guest-token" | "prepare" {
  return value === "start" || value === "stop" || value === "status" || value === "guest-token" || value === "prepare";
}

function sanitizeTitle(value: unknown): string {
  if (typeof value !== "string") return "Live Stream";
  // Whitelist: only allow letters, numbers, spaces, and safe punctuation
  const cleaned = value
    .replace(/[^a-zA-Z0-9\s\-_.,!?'()&:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned || "Live Stream";
}

function sanitizeGuestName(value: unknown): string {
  if (typeof value !== "string") return "Guest";
  const cleaned = value
    .replace(/[^a-zA-Z0-9\s\-_.']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return cleaned || "Guest";
}

// Basic email validation; returns null for absent/invalid input so the caller
// can treat "no email" as a link-only invite.
function sanitizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

// Validate the app origin the branded guest link is built from. Only a bare
// http(s) origin (no path) is accepted, defeating open-redirect style abuse.
function sanitizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

// Opaque, unguessable invite token (the capability embedded in the link).
function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Room/token lifetime. Generous so long streams aren't cut off mid-broadcast.
const SESSION_TTL_SECONDS = 6 * 60 * 60; // 6 hours
// Host + up to 7 guests
const MAX_PARTICIPANTS = 8;

async function dailyRequest(path: string, method: string, body?: unknown) {
  const apiKey = Deno.env.get("DAILY_API_KEY");
  if (!apiKey) throw new Error("Daily.co API key not configured");

  const url = `${DAILY_API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);

  // DELETE may return 204 with no body
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

// Create a private Daily room sized for the host + invited guests. Shared by
// `start` (go live) and `guest-token` (pre-live green-room invites).
async function createDailyRoom() {
  return await dailyRequest("/rooms", "POST", {
    privacy: "private",           // Require token to join — room name alone is not enough
    properties: {
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
      enable_knocking: false,     // Don't allow unauthenticated knock-to-join
      enable_screenshare: true,
      max_participants: MAX_PARTICIPANTS, // Broadcaster + invited guests
    },
  });
}

// Send a branded guest invite email via Resend. Best-effort: returns false on
// any failure (missing key, bad response) so the caller still hands back the
// copyable link. Never throws.
async function sendGuestInviteEmail(
  to: string,
  hostLabel: string,
  joinUrl: string,
): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") || "LivePost <onboarding@resend.dev>";
  if (!apiKey) {
    console.warn("RESEND_API_KEY not configured — skipping guest invite email");
    return false;
  }
  const safeUrl = joinUrl.replace(/"/g, "%22");
  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0d0f17">
      <h2 style="margin:0 0 8px">You're invited to join a live stream</h2>
      <p style="margin:0 0 20px;color:#4b5563">${hostLabel} invited you to appear as a guest. Click below, allow your camera and mic, and you'll be on the show.</p>
      <a href="${safeUrl}" style="display:inline-block;background:#06b4e0;color:#0d0f17;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:8px">Join the stream</a>
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;word-break:break-all">Or paste this link into your browser: ${safeUrl}</p>
    </div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: `${hostLabel} invited you to join their live stream`,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`Resend error: ${res.status} - ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend request failed:", err);
    return false;
  }
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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const passphrase = Deno.env.get("STREAM_KEY_PASSPHRASE");

    if (!passphrase) {
      console.error("STREAM_KEY_PASSPHRASE not configured");
      return errorResponse("Server configuration error", 500);
    }

    // ── Authentication ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Authentication required", 401);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: authError } = await userClient.auth.getClaims(token);
    if (authError || !claimsData?.claims) {
      return errorResponse("Invalid or expired token", 401);
    }
    const userId = claimsData.claims.sub as string;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Input validation ──
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
    if (!isValidAction(action)) {
      return errorResponse("Invalid action. Must be 'start', 'stop', 'status', 'prepare', or 'guest-token'.", 400);
    }

    switch (action) {
      case "start": {
        const title = sanitizeTitle(payload.title);

        // Get enabled destinations with decrypted stream keys (service-role only)
        const { data: destinations, error: destError } = await supabase
          .rpc("get_decrypted_destinations", { p_user_id: userId, p_passphrase: passphrase });

        if (destError) throw new Error("Failed to fetch destinations");

        const enabledDests = (destinations || []).filter((d: DecryptedDestination) => d.enabled);
        if (!enabledDests.length) {
          return errorResponse("No enabled destinations. Add at least one before going live.", 400);
        }

        // ── Step 1: Build RTMP endpoints from ALL enabled destinations ──
        // Daily.co supports multiple RTMP endpoints natively. Facebook
        // auto-publish destinations mint a fresh LIVE_NOW broadcast here so the
        // stream posts to the Page automatically; everything else joins the
        // stored URL + key as before.
        const rtmpEndpoints: string[] = [];
        const providerBroadcasts: { destination_id: string; live_video_id: string }[] = [];
        for (const d of enabledDests) {
          if (d.platform === "facebook" && d.provider_token && d.provider_account_id) {
            try {
              const { endpoint, liveVideoId } = await createFacebookBroadcast(
                d.provider_account_id, d.provider_token, title,
              );
              rtmpEndpoints.push(endpoint);
              providerBroadcasts.push({ destination_id: d.id, live_video_id: liveVideoId });
              console.log(`Facebook auto-publish broadcast created for ${d.name}: ${liveVideoId}`);
            } catch (err) {
              // Skip this destination rather than failing the whole broadcast.
              console.error(`Facebook broadcast failed for ${d.name}, skipping:`, err);
            }
          } else {
            rtmpEndpoints.push(
              d.stream_url.endsWith("/")
                ? `${d.stream_url}${d.stream_key}`
                : `${d.stream_url}/${d.stream_key}`,
            );
          }
        }

        if (!rtmpEndpoints.length) {
          return errorResponse(
            "Couldn't prepare any destination to stream to. Check your Facebook connection or stream keys.",
            502,
          );
        }

        const destNames = enabledDests.map((d: DecryptedDestination) => d.name).join(", ");
        console.log(`Destinations: ${destNames} (${enabledDests.length} total)`);

        // ── Step 2: Reuse a pre-created 'preparing' room (from green-room
        //    invites) or create a fresh Daily.co room for browser-to-RTMP ──
        const { data: preparing } = await supabase
          .from("stream_sessions")
          .select("id, daily_room_name")
          .eq("status", "preparing")
          .eq("user_id", userId)
          .not("daily_room_name", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);

        let dailyRoomName: string;
        let dailyRoomUrl: string;
        let sessionId: string;
        const prep = preparing?.[0];

        if (prep?.daily_room_name) {
          // Guests may already be waiting in this room — keep it and promote
          // the session to live rather than opening a second room.
          const room = await dailyRequest(`/rooms/${prep.daily_room_name}`, "GET");
          dailyRoomName = prep.daily_room_name;
          dailyRoomUrl = room.url;
          const { error: promoteErr } = await supabase
            .from("stream_sessions")
            .update({
              title,
              status: "live",
              started_at: new Date().toISOString(),
              destination_ids: enabledDests.map((d: DecryptedDestination) => d.id),
              provider_broadcasts: providerBroadcasts,
            })
            .eq("id", prep.id)
            .eq("user_id", userId);
          if (promoteErr) {
            console.error("Session promote error:", promoteErr);
            throw new Error("Failed to start stream session");
          }
          sessionId = prep.id;
          console.log(`Reusing prepared Daily room: ${dailyRoomName}`);
        } else {
          const dailyRoom = await createDailyRoom();
          dailyRoomName = dailyRoom.name;
          dailyRoomUrl = dailyRoom.url;
          const { data: session, error: sessionError } = await supabase
            .from("stream_sessions")
            .insert({
              title,
              status: "live",
              started_at: new Date().toISOString(),
              destination_ids: enabledDests.map((d: DecryptedDestination) => d.id),
              daily_room_name: dailyRoomName,
              user_id: userId,
              provider_broadcasts: providerBroadcasts,
            })
            .select()
            .single();
          if (sessionError) {
            console.error("Session insert error:", sessionError);
            throw new Error("Failed to create stream session");
          }
          sessionId = session.id;
          console.log(`Daily room created: ${dailyRoomName}`);
        }

        // ── Step 3: Fresh owner meeting token for the host ──
        // Label the host's Daily participant with their account display name
        // (then email local part, then email) so co-guests see a real name.
        let hostUserName = "Host";
        try {
          const { data: hostUser } = await supabase.auth.admin.getUserById(userId);
          const meta = hostUser?.user?.user_metadata as { display_name?: unknown } | undefined;
          const displayName = typeof meta?.display_name === "string" ? meta.display_name.trim() : "";
          const email = hostUser?.user?.email ?? "";
          hostUserName = displayName || email.split("@")[0] || email || hostUserName;
        } catch { /* non-fatal — fall back to "Host" */ }

        const tokenRes = await dailyRequest("/meeting-tokens", "POST", {
          properties: {
            room_name: dailyRoomName,
            is_owner: true,
            user_name: hostUserName,
            exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
          },
        });
        const dailyToken = tokenRes.token;

        console.log(
          `Stream started — User: ${userId}, Daily: ${dailyRoomName}, Session: ${sessionId}, Destinations: ${enabledDests.length}`,
        );

        return new Response(
          JSON.stringify({
            success: true,
            session_id: sessionId,
            destinations_count: enabledDests.length,
            daily_room_url: dailyRoomUrl,
            daily_token: dailyToken,
            daily_rtmp_endpoints: rtmpEndpoints,
            message: `Broadcasting from your browser to ${destNames} (${enabledDests.length} destination${enabledDests.length > 1 ? "s" : ""}).`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "stop": {
        const sessionId = payload.session_id;

        if (sessionId !== undefined && !isValidUUID(sessionId)) {
          return errorResponse("Invalid session_id format", 400);
        }

        let dailyRoomNames: string[] = [];
        // Facebook broadcasts created at go-live, so `stop` can end them.
        let providerBroadcasts: { destination_id: string; live_video_id: string }[] = [];

        if (isValidUUID(sessionId)) {
          const { data: session } = await supabase
            .from("stream_sessions")
            .select("daily_room_name, provider_broadcasts")
            .eq("id", sessionId)
            .eq("user_id", userId)
            .single();

          if (!session) {
            return errorResponse("Stream session not found or access denied", 404);
          }
          if (session.daily_room_name) dailyRoomNames = [session.daily_room_name];
          if (Array.isArray(session.provider_broadcasts)) providerBroadcasts = session.provider_broadcasts;
        } else {
          // A blanket stop ends live streams AND any 'preparing' green-room
          // sessions (created by pre-live invites) so their rooms don't leak.
          const { data: sessions } = await supabase
            .from("stream_sessions")
            .select("daily_room_name, id, provider_broadcasts")
            .in("status", ["live", "preparing"])
            .eq("user_id", userId);

          dailyRoomNames = (sessions ?? [])
            .map((s) => s.daily_room_name)
            .filter((name): name is string => Boolean(name));
          providerBroadcasts = (sessions ?? []).flatMap((s) =>
            Array.isArray(s.provider_broadcasts) ? s.provider_broadcasts : []
          );
        }

        // Best-effort: end each Facebook broadcast using its destination's token.
        if (providerBroadcasts.length) {
          const { data: decDests } = await supabase
            .rpc("get_decrypted_destinations", { p_user_id: userId, p_passphrase: passphrase });
          const tokenById = new Map<string, string>(
            (decDests || [])
              .filter((d: DecryptedDestination) => d.provider_token)
              .map((d: DecryptedDestination) => [d.id as string, d.provider_token as string]),
          );
          for (const b of providerBroadcasts) {
            const token = tokenById.get(b.destination_id);
            if (token && b.live_video_id) await endFacebookBroadcast(b.live_video_id, token);
          }
        }

        // Delete Daily room(s) — a blanket stop ends every live session,
        // so every associated room must be cleaned up, not just the first.
        for (const roomName of dailyRoomNames) {
          try {
            await dailyRequest(`/rooms/${roomName}`, "DELETE");
            console.log(`Daily room deleted: ${roomName}`);
          } catch (err) {
            console.error(`Failed to delete Daily room ${roomName}:`, err);
          }
        }

        // Revoke any outstanding guest invites for the closed room(s) so their
        // links can no longer resolve to a live token.
        if (dailyRoomNames.length) {
          await supabase
            .from("guest_invites")
            .update({ status: "revoked" })
            .in("daily_room_name", dailyRoomNames)
            .eq("host_user_id", userId)
            .neq("status", "revoked");
        }

        // Update session(s)
        const query = isValidUUID(sessionId)
          ? supabase
              .from("stream_sessions")
              .update({ status: "ended", ended_at: new Date().toISOString() })
              .eq("id", sessionId)
              .eq("user_id", userId)
          : supabase
              .from("stream_sessions")
              .update({ status: "ended", ended_at: new Date().toISOString() })
              .in("status", ["live", "preparing"])
              .eq("user_id", userId);

        const { error } = await query;
        if (error) {
          console.error("Session update error:", error);
          throw new Error("Failed to update session");
        }

        console.log(`Stream ended — User: ${userId}`);

        return new Response(
          JSON.stringify({ success: true, message: "Stream ended successfully" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "prepare": {
        // Enter the WAITING ROOM (backstage) without going live. Ensure a
        // 'preparing' Daily room exists — reusing the host's existing live or
        // preparing room if there is one, exactly like `guest-token` — and mint
        // an OWNER meeting token so the host can join and prep with any waiting
        // guests. No destinations, no RTMP, no promotion to 'live'. Going live
        // later reuses this same room (see the `start` case, step 2).
        const { data: sessions } = await supabase
          .from("stream_sessions")
          .select("daily_room_name")
          .in("status", ["live", "preparing"])
          .eq("user_id", userId)
          .not("daily_room_name", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);

        let dailyRoomName = sessions?.[0]?.daily_room_name as string | undefined;
        let dailyRoomUrl: string;

        if (dailyRoomName) {
          const room = await dailyRequest(`/rooms/${dailyRoomName}`, "GET");
          dailyRoomUrl = room.url;
          console.log(`Reusing room for waiting room: ${dailyRoomName}`);
        } else {
          const room = await createDailyRoom();
          dailyRoomName = room.name;
          dailyRoomUrl = room.url;
          const { error: prepErr } = await supabase
            .from("stream_sessions")
            .insert({
              title: "Live Stream",
              status: "preparing",
              daily_room_name: dailyRoomName,
              user_id: userId,
            });
          if (prepErr) {
            console.error("Preparing session insert error:", prepErr);
            throw new Error("Failed to prepare stream room");
          }
          console.log(`Prepared Daily room for waiting room: ${dailyRoomName}`);
        }

        // Owner token labeled with the host's display name (same logic as the
        // `start` case, step 3) so guests see a real name for the host.
        let hostUserName = "Host";
        try {
          const { data: hostUser } = await supabase.auth.admin.getUserById(userId);
          const meta = hostUser?.user?.user_metadata as { display_name?: unknown } | undefined;
          const displayName = typeof meta?.display_name === "string" ? meta.display_name.trim() : "";
          const email = hostUser?.user?.email ?? "";
          hostUserName = displayName || email.split("@")[0] || email || hostUserName;
        } catch { /* non-fatal — fall back to "Host" */ }

        const tokenRes = await dailyRequest("/meeting-tokens", "POST", {
          properties: {
            room_name: dailyRoomName,
            is_owner: true,
            user_name: hostUserName,
            exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
          },
        });

        console.log(`Waiting room ready — User: ${userId}, Daily: ${dailyRoomName}`);

        return new Response(
          JSON.stringify({
            success: true,
            daily_room_url: dailyRoomUrl,
            daily_token: tokenRes.token,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "guest-token": {
        // Create a branded guest invite for the user's stream. Guests open
        // ${app_origin}/guest/${token} (our own studio UI, not Daily Prebuilt);
        // the guest-access function resolves the token to a room + guest token.
        // Works BEFORE going live: if there's no live/preparing session yet, a
        // 'preparing' room is created so the guest can wait in the green room.
        const guestName = sanitizeGuestName(payload.guest_name);
        const email = sanitizeEmail(payload.email);
        const appOrigin = sanitizeOrigin(payload.app_origin)
          ?? sanitizeOrigin(req.headers.get("Origin"));
        if (!appOrigin) {
          return errorResponse("Missing or invalid app origin", 400);
        }

        // Reuse the host's existing live or preparing room if there is one.
        const { data: sessions } = await supabase
          .from("stream_sessions")
          .select("daily_room_name")
          .in("status", ["live", "preparing"])
          .eq("user_id", userId)
          .not("daily_room_name", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);

        let roomName = sessions?.[0]?.daily_room_name as string | undefined;

        // No room yet — create one and park a 'preparing' session so go-live
        // reuses it and the guest can join the green room immediately.
        if (!roomName) {
          const room = await createDailyRoom();
          roomName = room.name;
          const { error: prepErr } = await supabase
            .from("stream_sessions")
            .insert({
              title: "Live Stream",
              status: "preparing",
              daily_room_name: roomName,
              user_id: userId,
            });
          if (prepErr) {
            console.error("Preparing session insert error:", prepErr);
            throw new Error("Failed to prepare stream room");
          }
          console.log(`Prepared Daily room for green-room invite: ${roomName}`);
        }

        // Persist the invite; the opaque token is the capability in the link.
        const inviteToken = generateInviteToken();
        const { error: inviteErr } = await supabase
          .from("guest_invites")
          .insert({
            host_user_id: userId,
            invite_token: inviteToken,
            daily_room_name: roomName,
            guest_name: guestName,
            email,
            expires_at: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
          });
        if (inviteErr) {
          console.error("Guest invite insert error:", inviteErr);
          throw new Error("Failed to create guest invite");
        }

        const joinUrl = `${appOrigin}/guest/${inviteToken}`;

        // Best-effort email delivery (link is returned regardless).
        let emailed = false;
        if (email) {
          const hostLabel = claimsData.claims.email as string | undefined || "A host";
          emailed = await sendGuestInviteEmail(email, hostLabel, joinUrl);
        }

        console.log(`Guest invite created — User: ${userId}, Room: ${roomName}, Guest: ${guestName}, Emailed: ${emailed}`);

        return new Response(
          JSON.stringify({
            success: true,
            join_url: joinUrl,
            guest_name: guestName,
            emailed,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "status": {
        const { data: activeSessions, error } = await supabase
          .from("stream_sessions")
          .select("id, title, status, started_at, destination_ids")
          .eq("status", "live")
          .eq("user_id", userId);

        if (error) throw new Error("Failed to fetch status");

        return new Response(
          JSON.stringify({
            success: true,
            is_live: (activeSessions?.length ?? 0) > 0,
            sessions: activeSessions || [],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
  } catch (error) {
    console.error("Stream manager error:", error);
    return errorResponse("Unable to process stream request", 500);
  }
});
