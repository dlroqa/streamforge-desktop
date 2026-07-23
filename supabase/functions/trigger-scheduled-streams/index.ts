import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_BASE = "https://api.daily.co/v1";

interface DecryptedDestination {
  id: string;
  name: string;
  enabled: boolean;
  stream_url: string;
  stream_key: string;
}

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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const passphrase = Deno.env.get("STREAM_KEY_PASSPHRASE");

    // ── Authentication: Only allow service_role callers (pg_cron) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Authentication required", 401);
    }

    const token = authHeader.replace("Bearer ", "");
    try {
      // Decode the JWT payload to check the role claim
      const payloadB64 = token.split(".")[1];
      if (!payloadB64) {
        return errorResponse("Invalid token format", 401);
      }
      const payload = JSON.parse(atob(payloadB64));
      if (payload.role !== "service_role") {
        return errorResponse("Insufficient privileges — service_role required", 403);
      }
    } catch {
      return errorResponse("Invalid token", 401);
    }

    if (!passphrase) {
      console.error("STREAM_KEY_PASSPHRASE not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find pending scheduled streams that are due (within the last 2 minutes window)
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    const { data: dueStreams, error: fetchError } = await supabase
      .from("scheduled_streams")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", now.toISOString())
      .gte("scheduled_at", twoMinutesAgo.toISOString());

    if (fetchError) {
      console.error("Failed to fetch scheduled streams:", fetchError);
      throw new Error("Failed to fetch scheduled streams");
    }

    if (!dueStreams || dueStreams.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No streams due", triggered: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Found ${dueStreams.length} scheduled stream(s) to trigger`);

    let triggered = 0;

    for (const scheduled of dueStreams) {
      try {
        // Mark as running immediately to prevent duplicate triggers
        await supabase
          .from("scheduled_streams")
          .update({ status: "running" })
          .eq("id", scheduled.id);

        // Get enabled destinations for this user
        const { data: destinations, error: destError } = await supabase
          .rpc("get_decrypted_destinations", {
            p_user_id: scheduled.user_id,
            p_passphrase: passphrase,
          });

        if (destError) {
          console.error(`Failed to fetch destinations for user ${scheduled.user_id}:`, destError);
          await supabase
            .from("scheduled_streams")
            .update({ status: "failed" })
            .eq("id", scheduled.id);
          continue;
        }

        const enabledDests = (destinations || []).filter((d: DecryptedDestination) => d.enabled);
        if (!enabledDests.length) {
          console.log(`No enabled destinations for user ${scheduled.user_id}, marking failed`);
          await supabase
            .from("scheduled_streams")
            .update({ status: "failed" })
            .eq("id", scheduled.id);
          continue;
        }

        // Build RTMP endpoints
        const rtmpEndpoints: string[] = enabledDests.map((d: DecryptedDestination) => {
          return d.stream_url.endsWith("/")
            ? `${d.stream_url}${d.stream_key}`
            : `${d.stream_url}/${d.stream_key}`;
        });

        // Create Daily room
        const dailyRoom = await dailyRequest("/rooms", "POST", {
          privacy: "private",
          properties: {
            exp: Math.floor(Date.now() / 1000) + 7200,
            enable_knocking: false,
            enable_screenshare: true,
            max_participants: 1,
          },
        });

        // Create session record
        const { data: session, error: sessionError } = await supabase
          .from("stream_sessions")
          .insert({
            title: scheduled.title,
            status: "live",
            started_at: new Date().toISOString(),
            destination_ids: enabledDests.map((d: DecryptedDestination) => d.id),
            daily_room_name: dailyRoom.name,
            user_id: scheduled.user_id,
          })
          .select()
          .single();

        if (sessionError) {
          console.error("Session insert error:", sessionError);
          await supabase
            .from("scheduled_streams")
            .update({ status: "failed" })
            .eq("id", scheduled.id);
          continue;
        }

        // Link session to scheduled stream
        await supabase
          .from("scheduled_streams")
          .update({ session_id: session.id, status: "running" })
          .eq("id", scheduled.id);

        const destNames = enabledDests.map((d: DecryptedDestination) => d.name).join(", ");
        console.log(
          `Triggered scheduled stream "${scheduled.title}" — User: ${scheduled.user_id}, Daily: ${dailyRoom.name}, Destinations: ${destNames}`,
        );
        triggered++;
      } catch (err) {
        console.error(`Error triggering scheduled stream ${scheduled.id}:`, err);
        await supabase
          .from("scheduled_streams")
          .update({ status: "failed" })
          .eq("id", scheduled.id);
      }
    }

    return new Response(
      JSON.stringify({ success: true, triggered, total: dueStreams.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Trigger scheduled streams error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Unable to process scheduled streams" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
