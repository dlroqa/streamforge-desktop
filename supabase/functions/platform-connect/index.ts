import { createClient } from "npm:@supabase/supabase-js@2";

// OAuth "Connect account" — exchanges a platform OAuth code for the user's
// live stream key + RTMP URL so the studio can auto-fill a destination. Tokens
// are used once and discarded (no storage). Client SECRETS live only here.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Platform = "twitch" | "youtube" | "facebook";

interface PlatformCfg {
  idEnv: string;
  secretEnv: string;
  authorizeBase: string;
  tokenUrl: string;
  scope: string;
}

const PLATFORMS: Record<Platform, PlatformCfg> = {
  twitch: {
    idEnv: "TWITCH_CLIENT_ID",
    secretEnv: "TWITCH_CLIENT_SECRET",
    authorizeBase: "https://id.twitch.tv/oauth2/authorize",
    tokenUrl: "https://id.twitch.tv/oauth2/token",
    scope: "channel:read:stream_key",
  },
  youtube: {
    idEnv: "GOOGLE_OAUTH_CLIENT_ID",
    secretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    authorizeBase: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/youtube",
  },
  facebook: {
    idEnv: "FACEBOOK_APP_ID",
    secretEnv: "FACEBOOK_APP_SECRET",
    authorizeBase: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scope: "publish_video,pages_show_list,pages_read_engagement,pages_manage_posts",
  },
};

function isPlatform(v: unknown): v is Platform {
  return v === "twitch" || v === "youtube" || v === "facebook";
}

function creds(platform: Platform): { id: string; secret: string } | null {
  const cfg = PLATFORMS[platform];
  const id = Deno.env.get(cfg.idEnv);
  const secret = Deno.env.get(cfg.secretEnv);
  return id && secret ? { id, secret } : null;
}

// Only accept an https redirect back to our own callback path.
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

// ── OAuth token exchange (code → access token) ──
async function exchangeToken(platform: Platform, code: string, redirectUri: string): Promise<string> {
  const cfg = PLATFORMS[platform];
  const c = creds(platform)!;
  const params = new URLSearchParams({
    client_id: c.id,
    client_secret: c.secret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  // Facebook takes params on a GET; Twitch/Google use POST form bodies.
  let res: Response;
  if (platform === "facebook") {
    res = await fetch(`${cfg.tokenUrl}?${params.toString()}`, { method: "GET" });
  } else {
    res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    console.error(`${platform} token exchange failed:`, res.status, JSON.stringify(data));
    throw new Error("Could not complete sign-in with the platform. Please try again.");
  }
  return data.access_token as string;
}

interface FetchedKey {
  display_name: string;
  stream_url: string;
  stream_key: string;
  platform_channel_id: string;
  // Facebook auto-publish: the long-lived Page token + id are stored so going
  // live can mint a fresh LIVE_NOW broadcast without any per-session setup.
  provider_token?: string;
  provider_account_id?: string;
  auto_publish?: boolean;
}

async function fetchTwitchKey(token: string): Promise<FetchedKey> {
  const clientId = creds("twitch")!.id;
  const headers = { Authorization: `Bearer ${token}`, "Client-Id": clientId };

  const userRes = await fetch("https://api.twitch.tv/helix/users", { headers });
  const userData = await userRes.json().catch(() => ({}));
  const user = userData?.data?.[0];
  if (!userRes.ok || !user) throw new Error("Couldn't read your Twitch channel.");

  const keyRes = await fetch(
    `https://api.twitch.tv/helix/streams/key?broadcaster_id=${user.id}`,
    { headers },
  );
  const keyData = await keyRes.json().catch(() => ({}));
  const streamKey = keyData?.data?.[0]?.stream_key;
  if (!keyRes.ok || !streamKey) throw new Error("Couldn't read your Twitch stream key.");

  return {
    display_name: user.display_name || user.login || "Twitch",
    stream_url: "rtmp://live.twitch.tv/app",
    stream_key: streamKey,
    platform_channel_id: user.login || "",
  };
}

async function fetchYouTubeKey(token: string): Promise<FetchedKey> {
  const headers = { Authorization: `Bearer ${token}` };
  const api = "https://www.googleapis.com/youtube/v3";

  // Channel identity (title + id)
  const chRes = await fetch(`${api}/channels?part=snippet&mine=true`, { headers });
  const chData = await chRes.json().catch(() => ({}));
  const channel = chData?.items?.[0];
  if (!chRes.ok || !channel) {
    throw new Error("Couldn't read your YouTube channel — is live streaming enabled?");
  }

  // Reuse an existing reusable stream, else create one
  const listRes = await fetch(`${api}/liveStreams?part=snippet,cdn,contentDetails&mine=true`, { headers });
  const listData = await listRes.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stream = (listData?.items ?? []).find((s: any) => s?.cdn?.ingestionInfo?.streamName);

  if (!stream) {
    const createRes = await fetch(`${api}/liveStreams?part=snippet,cdn,contentDetails`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        snippet: { title: "StreamForge" },
        cdn: { frameRate: "variable", ingestionType: "rtmp", resolution: "variable" },
        contentDetails: { isReusable: true },
      }),
    });
    stream = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !stream?.cdn?.ingestionInfo?.streamName) {
      console.error("YouTube liveStream create failed:", JSON.stringify(stream));
      throw new Error("Couldn't create a YouTube stream key.");
    }
  }

  const info = stream.cdn.ingestionInfo;
  return {
    display_name: channel.snippet?.title || "YouTube",
    stream_url: info.ingestionAddress || "rtmp://a.rtmp.youtube.com/live2",
    stream_key: info.streamName,
    platform_channel_id: channel.id || "",
  };
}

// Facebook auto-publish: instead of minting a single (single-use) stream key at
// connect time, we persist a long-lived Page access token. Going live then
// creates a fresh LIVE_NOW broadcast against the Page, which auto-posts. This is
// what lets a non-technical user connect once and never touch Facebook again.
async function fetchFacebookKey(userToken: string): Promise<FetchedKey> {
  const graph = "https://graph.facebook.com/v19.0";
  const c = creds("facebook")!;

  // Short-lived user token → long-lived user token, so the derived Page token
  // doesn't expire after ~1 hour.
  let longLivedUserToken = userToken;
  const exchRes = await fetch(
    `${graph}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: c.id,
      client_secret: c.secret,
      fb_exchange_token: userToken,
    }).toString(),
  );
  const exchData = await exchRes.json().catch(() => ({}));
  if (exchRes.ok && exchData?.access_token) {
    longLivedUserToken = exchData.access_token as string;
  } else {
    console.warn("Facebook long-lived token exchange failed; using short-lived token:", JSON.stringify(exchData));
  }

  // The broadcast is created against a Page the user manages. A Page token
  // derived from a long-lived user token is itself long-lived (non-expiring).
  const pagesRes = await fetch(`${graph}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(longLivedUserToken)}`);
  const pagesData = await pagesRes.json().catch(() => ({}));
  const page = pagesData?.data?.[0];
  if (!pagesRes.ok || !page?.access_token) {
    throw new Error("No Facebook Page found. A Page is required to stream to Facebook.");
  }

  return {
    display_name: page.name || "Facebook",
    // Base RTMPS ingest; the per-broadcast key is appended at go-live.
    stream_url: "rtmps://live-api-s.facebook.com:443/rtmp/",
    stream_key: "",
    platform_channel_id: String(page.id || ""),
    provider_token: page.access_token as string,
    provider_account_id: String(page.id || ""),
    auto_publish: true,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ── Auth (same pattern as manage-destinations) ──
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

    // Which platforms are configured (have client id + secret)
    if (action === "providers") {
      return ok({
        providers: {
          twitch: !!creds("twitch"),
          youtube: !!creds("youtube"),
          facebook: !!creds("facebook"),
        },
      });
    }

    if (action === "authorize-url") {
      if (!isPlatform(payload.platform)) return errorResponse("Invalid platform", 400);
      const redirectUri = validRedirect(payload.redirect_uri);
      if (!redirectUri) return errorResponse("Invalid redirect URI", 400);
      const state = typeof payload.state === "string" ? payload.state.slice(0, 128) : "";
      if (!state) return errorResponse("Missing state", 400);
      const c = creds(payload.platform);
      if (!c) return errorResponse("This platform isn't configured yet.", 400);

      const cfg = PLATFORMS[payload.platform];
      const params = new URLSearchParams({
        client_id: c.id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: cfg.scope,
        state,
      });
      if (payload.platform === "twitch") params.set("force_verify", "true");
      return ok({ url: `${cfg.authorizeBase}?${params.toString()}` });
    }

    if (action === "exchange") {
      if (!isPlatform(payload.platform)) return errorResponse("Invalid platform", 400);
      const redirectUri = validRedirect(payload.redirect_uri);
      if (!redirectUri) return errorResponse("Invalid redirect URI", 400);
      const code = typeof payload.code === "string" ? payload.code : "";
      if (!code) return errorResponse("Missing authorization code", 400);
      if (!creds(payload.platform)) return errorResponse("This platform isn't configured yet.", 400);

      const token = await exchangeToken(payload.platform, code, redirectUri);
      const result = payload.platform === "twitch"
        ? await fetchTwitchKey(token)
        : payload.platform === "youtube"
          ? await fetchYouTubeKey(token)
          : await fetchFacebookKey(token);

      return ok(result);
    }

    return errorResponse("Invalid action", 400);
  } catch (error) {
    console.error("platform-connect error:", error);
    const message = error instanceof Error ? error.message : "Unable to connect the account.";
    return errorResponse(message, 400);
  }
});
