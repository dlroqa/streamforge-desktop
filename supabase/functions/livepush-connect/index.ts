import { createClient } from "npm:@supabase/supabase-js@2";

// Livepush "Connect" — one-click OAuth so a user links their OWN Livepush account
// and the studio can read that account's per-stream RTMP ingest (server URL +
// key). The studio then pushes its single composite to that ingest, and Livepush
// fans it out to the 40+ social platforms the user has linked INSIDE Livepush.
//
// Multi-tenant by construction: the only shared secret is our ONE Livepush
// developer app (LIVEPUSH_CLIENT_ID/SECRET, held only here). Every user's
// Livepush account and their social logins stay entirely theirs.
//
// The ingest URL + key are returned to the browser and stored ENCRYPTED as a
// normal `livepush` stream_destination (so go-live can decrypt + push, exactly
// like every other destination). The OAuth access/refresh token is returned too
// but kept client-side (localStorage), used only for optional status display —
// mirroring the Google Drive / Freesound token pattern.
//
// ─────────────────────────────────────────────────────────────────────────────
// Endpoints/scopes below are the documented Livepush developer contract
// (dev.livepush.io/docs): OAuth on id.livepush.io / tokens.livepush.io and the
// REST API on octopus.livepush.io. Two items are worth confirming against a live
// developer account: the exact token-request encoding (docs show query-style
// params — we send both query + form body to be safe) and the precise
// `zone`→ingest-URL field names (tolerated via normalizeStream()).
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Livepush endpoints / scopes (dev.livepush.io/docs) ──
const LIVEPUSH_AUTHORIZE_URL = "https://id.livepush.io/oauth2/authorize";
const LIVEPUSH_TOKEN_URL = "https://tokens.livepush.io/oauth2/access_token";
const LIVEPUSH_API_BASE = "https://octopus.livepush.io";
// Read+create the user's stream; read/toggle their destinations. NOTE: Livepush
// expects a COMMA-delimited scope list (non-standard).
const LIVEPUSH_SCOPE =
  "profile.read,streams.read,streams.write,streams.create,streams.destinations.write";
// Public RTMP publish server. The full push URL is this + the stream key, e.g.
// rtmp://stream.livepush.io/live/rtmp_xxxx — confirmed against a live account's
// "RTMP Input" screen (OBS-verified). This is the real ingest — NOT the internal
// origin exposed in `zone`, and NOT the older us-ws.livepush.io/rtmp/ form.
const LIVEPUSH_PUBLIC_INGEST = "rtmp://stream.livepush.io/live/";

function creds(): { id: string; secret: string } | null {
  const id = Deno.env.get("LIVEPUSH_CLIENT_ID");
  const secret = Deno.env.get("LIVEPUSH_CLIENT_SECRET");
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

interface LivepushTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

// OAuth token endpoint — shared by exchange (code) and refresh (refresh_token).
// Livepush's token endpoint is a GET with ALL params in the query string
// (dev.livepush.io/docs/authentication/tokens) — not a POST-body exchange.
async function livepushTokenRequest(params: Record<string, string>): Promise<LivepushTokens> {
  const c = creds()!;
  const all = new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params });
  const res = await fetch(`${LIVEPUSH_TOKEN_URL}?${all.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(raw); } catch { /* non-JSON error page */ }
  if (!res.ok || !data.access_token) {
    console.error("livepush token request failed:", res.status, raw.slice(0, 500));
    // Surface the upstream status + a short snippet so failures are actionable
    // (Livepush's error body doesn't contain our client secret).
    const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      `Could not complete sign-in with Livepush (status ${res.status})${snippet ? `: ${snippet}` : ""}. Please try again.`,
    );
  }
  return {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) ?? undefined,
    expires_in: (data.expires_in as number) ?? undefined,
  };
}

// A single fan-out target inside the user's Livepush stream.
interface LivepushDestination {
  id: string;
  appName: string; // platform id, e.g. "twitch"
  label: string;
  isDisabled: boolean;
}

interface LivepushStream {
  stream_id: string;
  display_name: string;
  stream_url: string; // ingest server (ends with a trailing slash)
  stream_key: string; // key_xxxx
  account_id: string;
  destinations: LivepushDestination[];
}

// GET a single stream by id, returning the raw record.
async function livepushGetStreamRaw(bearer: string, id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${LIVEPUSH_API_BASE}/streams/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("livepush get stream failed:", res.status, JSON.stringify(data));
    throw new Error("Couldn't read your Livepush stream.");
  }
  return (data?.data ?? data) as Record<string, unknown>;
}

// GET a single stream by id and normalize it.
async function livepushGetStream(bearer: string, id: string): Promise<LivepushStream> {
  return normalizeStream(await livepushGetStreamRaw(bearer, id));
}

// Raw list of the user's streams. Tolerates a bare array or { data: [...] }.
async function livepushListStreamsRaw(bearer: string): Promise<Record<string, unknown>[]> {
  const listRes = await fetch(`${LIVEPUSH_API_BASE}/streams/mine`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const listData = await listRes.json().catch(() => ({}));
  if (!listRes.ok) {
    console.error("livepush list streams failed:", listRes.status, JSON.stringify(listData));
    throw new Error("Couldn't read your Livepush account.");
  }
  return Array.isArray(listData)
    ? listData
    : Array.isArray(listData?.data)
      ? listData.data
      : Array.isArray(listData?.streams)
        ? listData.streams
        : [];
}

async function livepushCreateStream(bearer: string): Promise<Record<string, unknown>> {
  const createRes = await fetch(`${LIVEPUSH_API_BASE}/streams`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "StreamForge" }),
  });
  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    console.error("livepush create stream failed:", createRes.status, JSON.stringify(createData));
    throw new Error("Couldn't create a Livepush stream.");
  }
  return (createData?.data ?? createData) as Record<string, unknown>;
}

// Resolve the RIGHT stream for the user: an account can hold several streams, and
// the list endpoint may return summaries without destinations. So we fetch full
// details for each and pick the stream that actually has destinations (falling
// back to the first). Creates a stream only when the account has none.
async function livepushResolveBestStream(bearer: string): Promise<LivepushStream> {
  const raw = await livepushListStreamsRaw(bearer);
  if (raw.length === 0) {
    return normalizeStream(await livepushCreateStream(bearer));
  }

  let normalized = raw.map(normalizeStream);
  // If the list omitted destinations (summary rows), fetch details to find them.
  if (normalized.every((s) => s.destinations.length === 0)) {
    normalized = await Promise.all(
      normalized.slice(0, 10).map((s) =>
        s.stream_id ? livepushGetStream(bearer, s.stream_id).catch(() => s) : Promise.resolve(s)
      ),
    );
  }

  // Prefer the stream with the most destinations; else the first.
  normalized.sort((a, b) => b.destinations.length - a.destinations.length);
  return normalized[0];
}

// Map Livepush's stream record onto our fixed shape, tolerating field-name
// variance. Ingest is built from the `zone` (host/port/path) + streamKey.
function normalizeStream(s: Record<string, unknown>): LivepushStream {
  const get = (obj: Record<string, unknown>, ...keys: string[]): string => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v) return v;
      if (typeof v === "number") return String(v);
    }
    return "";
  };

  // Resolve the RTMP publish server. Livepush publishes to a PUBLIC edge —
  // documented (help center + OBS guide) as rtmp://us-ws.livepush.io/rtmp/ plus
  // the streamKey. The `zone` object exposes the INTERNAL origin
  // (host/publishPort/publishPath, e.g. 127.0.0.1:1936/show) which is NOT the
  // public push target, so we don't build the URL from it. Prefer an explicit
  // public rtmp URL if the API surfaces one; else use the documented server.
  const cfg = (s.config as Record<string, unknown>) ?? {};
  const explicit =
    get(cfg, "publishUrl", "rtmpUrl", "serverUrl", "ingestUrl", "server") ||
    get(s, "publishUrl", "rtmp_url", "ingest_url", "streaming_server", "server_url");
  const server = /^rtmps?:\/\//i.test(explicit) ? explicit : LIVEPUSH_PUBLIC_INGEST;
  const key = get(s, "streamKey", "ingest_key", "stream_key", "streaming_key", "key");

  // Ensure server + key concatenate to a valid rtmp://host/app/key.
  const stream_url = server.endsWith("/") ? server : `${server}/`;

  return {
    stream_id: get(s, "id", "stream_id", "account_id"),
    display_name: get((s.metadata as Record<string, unknown>) ?? s, "name", "title") || "Livepush",
    stream_url,
    stream_key: key,
    account_id: get(s, "account_id", "id"),
    destinations: normalizeDestinations(s.destinations ?? s.channels),
  };
}

// Map a stream's destination array onto our fixed shape.
function normalizeDestinations(raw: unknown): LivepushDestination[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d): LivepushDestination | null => {
      if (!d || typeof d !== "object") return null;
      const o = d as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : String(o.id ?? "");
      const appName = typeof o.appName === "string" ? o.appName
        : typeof o.platform === "string" ? o.platform : "";
      if (!id) return null;
      return {
        id,
        appName,
        label: typeof o.label === "string" && o.label ? o.label : appName || "Destination",
        isDisabled: o.isDisabled === true,
      };
    })
    .filter((d): d is LivepushDestination => d !== null);
}

// List the user's destinations for the connected UI. Uses the stored stream id
// when available; if that stream has no destinations (e.g. we stored a freshly
// created/empty one), scans the account for a populated stream instead.
async function livepushDestinations(
  bearer: string,
  streamId?: string,
): Promise<{ stream_id: string; destinations: LivepushDestination[] }> {
  if (streamId) {
    const stream = await livepushGetStream(bearer, streamId);
    if (stream.destinations.length > 0) {
      return { stream_id: stream.stream_id, destinations: stream.destinations };
    }
  }
  const best = await livepushResolveBestStream(bearer);
  return { stream_id: best.stream_id, destinations: best.destinations };
}

// Enable or disable one destination on a stream.
async function livepushToggleDestination(
  bearer: string,
  streamId: string,
  destinationId: string,
  enable: boolean,
): Promise<boolean> {
  const action = enable ? "enable" : "disable";
  const res = await fetch(
    `${LIVEPUSH_API_BASE}/streams/${encodeURIComponent(streamId)}/destinations/${encodeURIComponent(destinationId)}/${action}`,
    { method: "PUT", headers: { Authorization: `Bearer ${bearer}` } },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.error("livepush toggle destination failed:", res.status, JSON.stringify(data));
    throw new Error(`Couldn't ${action} that platform on Livepush.`);
  }
  return enable;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ── Auth (same pattern as platform-connect / google-drive-auth) ──
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

    // Is our Livepush developer app configured server-side?
    if (action === "providers") {
      return ok({ configured: !!creds() });
    }

    if (action === "authorize-url") {
      const redirectUri = validRedirect(payload.redirect_uri);
      if (!redirectUri) return errorResponse("Invalid redirect URI", 400);
      const state = typeof payload.state === "string" ? payload.state.slice(0, 128) : "";
      if (!state) return errorResponse("Missing state", 400);
      const c = creds();
      if (!c) return errorResponse("Livepush isn't configured yet.", 400);

      const params = new URLSearchParams({
        client_id: c.id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: LIVEPUSH_SCOPE,
        state,
      });
      return ok({ url: `${LIVEPUSH_AUTHORIZE_URL}?${params.toString()}` });
    }

    if (action === "exchange") {
      const redirectUri = validRedirect(payload.redirect_uri);
      if (!redirectUri) return errorResponse("Invalid redirect URI", 400);
      const code = typeof payload.code === "string" ? payload.code : "";
      if (!code) return errorResponse("Missing authorization code", 400);
      if (!creds()) return errorResponse("Livepush isn't configured yet.", 400);

      const tokens = await livepushTokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        response_type: "code",
      });
      const stream = await livepushResolveBestStream(tokens.access_token);
      if (!stream.stream_key) {
        throw new Error("Livepush didn't return a stream key for your account.");
      }

      // Ingest url+key → stored encrypted client-side as a destination.
      // Livepush tokens + stream id → returned for client-side (localStorage)
      // status use and per-destination toggling.
      return ok({
        display_name: stream.display_name,
        stream_url: stream.stream_url,
        stream_key: stream.stream_key,
        platform_channel_id: stream.account_id,
        stream_id: stream.stream_id,
        destinations: stream.destinations,
        livepush: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          expires_in: tokens.expires_in ?? null,
          account_id: stream.account_id,
          stream_id: stream.stream_id,
        },
      });
    }

    if (action === "refresh") {
      const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
      if (!refreshToken) return errorResponse("Missing refresh token", 400);
      if (!creds()) return errorResponse("Livepush isn't configured yet.", 400);
      const tokens = await livepushTokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      return ok({
        livepush: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          expires_in: tokens.expires_in ?? null,
        },
      });
    }

    // Read the account's destinations (id/appName/label/isDisabled) for the UI.
    if (action === "list-destinations") {
      const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
      if (!accessToken) return errorResponse("Missing access token", 400);
      const streamId = typeof payload.stream_id === "string" ? payload.stream_id : undefined;
      const result = await livepushDestinations(accessToken, streamId);
      return ok(result);
    }

    // Enable/disable a single destination — the per-platform toggle.
    if (action === "toggle-destination") {
      const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
      if (!accessToken) return errorResponse("Missing access token", 400);
      const streamId = typeof payload.stream_id === "string" ? payload.stream_id : "";
      const destinationId = typeof payload.destination_id === "string" ? payload.destination_id : "";
      if (!streamId || !destinationId) return errorResponse("Missing stream or destination id", 400);
      const enable = payload.enable === true;
      await livepushToggleDestination(accessToken, streamId, destinationId, enable);
      return ok({ isDisabled: !enable });
    }

    return errorResponse("Invalid action", 400);
  } catch (error) {
    console.error("livepush-connect error:", error);
    const message = error instanceof Error ? error.message : "Unable to connect Livepush.";
    return errorResponse(message, 400);
  }
});
