import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Resolve the active live chat id for a channel's current live broadcast. */
async function resolveLiveChatId(channelId: string, apiKey: string): Promise<string | null> {
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&key=${encodeURIComponent(apiKey)}`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    console.error("YouTube search API error:", searchRes.status, await searchRes.text());
    return null;
  }
  const searchData = await searchRes.json();
  const videoId = searchData.items?.[0]?.id?.videoId;
  if (!videoId) return null;

  const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${encodeURIComponent(apiKey)}`;
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) return null;
  const videoData = await videoRes.json();
  return videoData.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const apiKey = Deno.env.get("YOUTUBE_API_KEY");

    // ── Authentication ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "Authentication required" }, 401);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: authError } = await userClient.auth.getClaims(token);
    if (authError || !claimsData?.claims) {
      return jsonResponse({ success: false, error: "Invalid token" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    if (!apiKey) {
      return jsonResponse({ success: false, error: "YouTube API key not configured on the server" });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch { /* empty body is fine */ }

    let liveChatId = typeof body.live_chat_id === "string" ? body.live_chat_id : null;
    const pageToken = typeof body.page_token === "string" ? body.page_token : null;

    // ── Resolve the chat id from the user's YouTube destination if needed ──
    if (!liveChatId) {
      const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: destinations } = await supabase
        .from("stream_destinations")
        .select("platform, platform_channel_id, enabled")
        .eq("user_id", userId)
        .eq("enabled", true)
        .eq("platform", "youtube")
        .not("platform_channel_id", "is", null)
        .limit(1);

      const channelId = destinations?.[0]?.platform_channel_id;
      if (!channelId) {
        return jsonResponse({
          success: false,
          error: "No YouTube destination with a channel ID configured",
        });
      }

      liveChatId = await resolveLiveChatId(channelId, apiKey);
      if (!liveChatId) {
        return jsonResponse({
          success: false,
          error: "No active YouTube live broadcast found for this channel",
        });
      }
    }

    // ── Fetch chat messages ──
    const params = new URLSearchParams({
      part: "snippet,authorDetails",
      liveChatId,
      maxResults: "200",
      key: apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const chatRes = await fetch(
      `https://www.googleapis.com/youtube/v3/liveChat/messages?${params.toString()}`,
    );
    if (!chatRes.ok) {
      const errText = await chatRes.text();
      console.error("YouTube liveChat API error:", chatRes.status, errText);
      // Chat may have ended (broadcast finished) — tell the client to re-resolve
      return jsonResponse({
        success: false,
        error: "YouTube chat unavailable",
        chat_ended: chatRes.status === 403 || chatRes.status === 404,
      });
    }
    const chatData = await chatRes.json();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = (chatData.items ?? []).map((item: any) => ({
      id: item.id,
      author: item.authorDetails?.displayName ?? "Viewer",
      text: item.snippet?.displayMessage ?? "",
      published_at: item.snippet?.publishedAt ?? null,
    })).filter((m: { text: string }) => m.text);

    return jsonResponse({
      success: true,
      live_chat_id: liveChatId,
      next_page_token: chatData.nextPageToken ?? null,
      polling_interval_ms: chatData.pollingIntervalMillis ?? 5000,
      messages,
    });
  } catch (error) {
    console.error("YouTube chat error:", error);
    return jsonResponse({ success: false, error: "Unable to fetch YouTube chat" }, 500);
  }
});
