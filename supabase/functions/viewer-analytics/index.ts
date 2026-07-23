import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PlatformViewerCount {
  platform: string;
  name: string;
  viewers: number | null;
  error?: string;
}

async function getYouTubeViewers(channelId: string, apiKey: string): Promise<number | null> {
  try {
    // Search for active live broadcasts on this channel
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&key=${encodeURIComponent(apiKey)}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      console.error("YouTube search API error:", searchRes.status, await searchRes.text());
      return null;
    }
    const searchData = await searchRes.json();
    if (!searchData.items?.length) return 0;

    const videoId = searchData.items[0].id.videoId;
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${encodeURIComponent(apiKey)}`;
    const statsRes = await fetch(statsUrl);
    if (!statsRes.ok) return null;
    const statsData = await statsRes.json();

    const concurrentViewers = statsData.items?.[0]?.liveStreamingDetails?.concurrentViewers;
    return concurrentViewers != null ? parseInt(concurrentViewers, 10) : 0;
  } catch (err) {
    console.error("YouTube viewer fetch error:", err);
    return null;
  }
}

async function getTwitchViewers(
  channelLogin: string,
  clientId: string,
  clientSecret: string,
): Promise<number | null> {
  try {
    // Get app access token
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
    });
    if (!tokenRes.ok) {
      console.error("Twitch token error:", tokenRes.status);
      return null;
    }
    const tokenData = await tokenRes.json();

    const streamRes = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channelLogin)}`,
      {
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      },
    );
    if (!streamRes.ok) return null;
    const streamData = await streamRes.json();

    if (!streamData.data?.length) return 0;
    return streamData.data[0].viewer_count ?? 0;
  } catch (err) {
    console.error("Twitch viewer fetch error:", err);
    return null;
  }
}

async function getFacebookViewers(
  liveVideoId: string,
  accessToken: string,
): Promise<number | null> {
  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(liveVideoId)}?fields=live_views&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("Facebook API error:", res.status);
      return null;
    }
    const data = await res.json();
    return data.live_views ?? 0;
  } catch (err) {
    console.error("Facebook viewer fetch error:", err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: authError } = await userClient.auth.getClaims(token);
    if (authError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = claimsData.claims.sub as string;

    // Fetch user's enabled destinations with platform_channel_id
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: destinations, error: destError } = await supabase
      .from("stream_destinations")
      .select("id, platform, name, platform_channel_id, enabled")
      .eq("user_id", userId)
      .eq("enabled", true);

    if (destError) {
      console.error("Fetch destinations error:", destError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch destinations" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Platform API credentials
    const youtubeKey = Deno.env.get("YOUTUBE_API_KEY");
    const twitchClientId = Deno.env.get("TWITCH_CLIENT_ID");
    const twitchClientSecret = Deno.env.get("TWITCH_CLIENT_SECRET");
    const fbAccessToken = Deno.env.get("FACEBOOK_ACCESS_TOKEN");

    // Fetch viewer counts in parallel
    const results: PlatformViewerCount[] = await Promise.all(
      (destinations || [])
        .filter((d) => d.platform_channel_id)
        .map(async (dest) => {
          let viewers: number | null = null;
          let error: string | undefined;

          switch (dest.platform) {
            case "youtube":
              if (youtubeKey) {
                viewers = await getYouTubeViewers(dest.platform_channel_id!, youtubeKey);
              } else {
                error = "YouTube API key not configured";
              }
              break;
            case "twitch":
              if (twitchClientId && twitchClientSecret) {
                viewers = await getTwitchViewers(
                  dest.platform_channel_id!,
                  twitchClientId,
                  twitchClientSecret,
                );
              } else {
                error = "Twitch credentials not configured";
              }
              break;
            case "facebook":
              if (fbAccessToken) {
                viewers = await getFacebookViewers(dest.platform_channel_id!, fbAccessToken);
              } else {
                error = "Facebook access token not configured";
              }
              break;
            default:
              error = "Unsupported platform for viewer analytics";
          }

          return {
            platform: dest.platform,
            name: dest.name,
            viewers,
            ...(error ? { error } : {}),
          };
        }),
    );

    const totalViewers = results.reduce((sum, r) => sum + (r.viewers ?? 0), 0);

    return new Response(
      JSON.stringify({
        success: true,
        total_viewers: totalViewers,
        platforms: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Viewer analytics error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Unable to fetch viewer analytics" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
