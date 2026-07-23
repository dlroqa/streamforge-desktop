import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function errorResponse(message: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function isValidAction(v: unknown): v is "list" | "add" | "update" | "delete" | "toggle" {
  return v === "list" || v === "add" || v === "update" || v === "delete" || v === "toggle";
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(v: unknown): v is string {
  return typeof v === "string" && UUID_REGEX.test(v);
}

const VALID_PLATFORMS = ["youtube", "twitch", "facebook", "custom", "livepush"];

function sanitizeString(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[^\x20-\x7E]/g, "").trim().slice(0, maxLen);
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

    // ── Input ──
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
      return errorResponse("Invalid action. Must be 'list', 'add', 'update', 'delete', or 'toggle'.", 400);
    }

    switch (action) {
      case "list": {
        const { data, error } = await supabase
          .rpc("get_user_destinations_by_id", { p_user_id: userId });

        if (error) {
          console.error("List destinations error:", error);
          return errorResponse("Failed to fetch destinations", 500);
        }

        return new Response(
          JSON.stringify({ success: true, destinations: data || [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "add": {
        const platform = sanitizeString(payload.platform, 50);
        const name = sanitizeString(payload.name, 200);
        const streamKey = sanitizeString(payload.stream_key, 500);
        const streamUrl = sanitizeString(payload.stream_url, 500);
        const platformChannelId = sanitizeString(payload.platform_channel_id, 200);
        // Facebook auto-publish: a long-lived Page token replaces the static key.
        const providerToken = sanitizeString(payload.provider_token, 1000);
        const providerAccountId = sanitizeString(payload.provider_account_id, 200);
        const enabled = payload.enabled !== false;

        if (!platform || !VALID_PLATFORMS.includes(platform)) {
          return errorResponse("Invalid platform", 400);
        }
        if (!name) return errorResponse("Name is required", 400);
        // A provider token (auto-publish) stands in for a manual stream key.
        if (!streamKey && !providerToken) return errorResponse("Stream key is required", 400);
        if (!streamUrl) return errorResponse("Stream URL is required", 400);

        // stream_key is NOT NULL — store a placeholder when auto-publish supplies
        // the token instead (the real per-broadcast key is minted at go-live).
        const keyToStore = streamKey || "auto";

        const { data, error } = await supabase
          .rpc("insert_destination_encrypted", {
            p_user_id: userId,
            p_platform: platform,
            p_name: name,
            p_stream_key: keyToStore,
            p_stream_url: streamUrl,
            p_enabled: enabled,
            p_passphrase: passphrase,
            p_provider_token: providerToken || null,
            p_provider_account_id: providerAccountId || null,
          });

        if (error) {
          console.error("Add destination error:", error);
          return errorResponse("Failed to add destination", 500);
        }

        // Update platform_channel_id separately (not part of the encrypted insert RPC)
        const row = Array.isArray(data) ? data[0] : data;
        if (row && platformChannelId) {
          await supabase
            .from("stream_destinations")
            .update({ platform_channel_id: platformChannelId })
            .eq("id", row.id)
            .eq("user_id", userId);
          row.platform_channel_id = platformChannelId;
        }

        return new Response(
          JSON.stringify({ success: true, destination: row }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "update": {
        const id = payload.id;
        if (!isValidUUID(id)) return errorResponse("Invalid destination ID", 400);

        const name = sanitizeString(payload.name, 200);
        const streamUrl = sanitizeString(payload.stream_url, 500);
        const platformChannelId = sanitizeString(payload.platform_channel_id, 200);
        // Blank key = keep the existing encrypted key (keys are write-only)
        const streamKey = sanitizeString(payload.stream_key, 500);
        // Blank token/id = keep existing (write-only, like the stream key)
        const providerToken = sanitizeString(payload.provider_token, 1000);
        const providerAccountId = sanitizeString(payload.provider_account_id, 200);

        if (!name) return errorResponse("Name is required", 400);
        if (!streamUrl) return errorResponse("Stream URL is required", 400);

        const { data, error } = await supabase
          .rpc("update_destination_encrypted", {
            p_id: id,
            p_user_id: userId,
            p_name: name,
            p_stream_url: streamUrl,
            p_platform_channel_id: platformChannelId,
            p_stream_key: streamKey,
            p_passphrase: passphrase,
            p_provider_token: providerToken || null,
            p_provider_account_id: providerAccountId || null,
          });

        if (error) {
          console.error("Update destination error:", error);
          return errorResponse("Failed to update destination", 500);
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return errorResponse("Destination not found", 404);

        return new Response(
          JSON.stringify({ success: true, destination: row }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "delete": {
        const id = payload.id;
        if (!isValidUUID(id)) return errorResponse("Invalid destination ID", 400);

        const { error } = await supabase
          .from("stream_destinations")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);

        if (error) {
          console.error("Delete destination error:", error);
          return errorResponse("Failed to delete destination", 500);
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "toggle": {
        const id = payload.id;
        if (!isValidUUID(id)) return errorResponse("Invalid destination ID", 400);

        // Fetch current state
        const { data: current, error: fetchErr } = await supabase
          .from("stream_destinations")
          .select("enabled")
          .eq("id", id)
          .eq("user_id", userId)
          .single();

        if (fetchErr || !current) {
          return errorResponse("Destination not found", 404);
        }

        const { error } = await supabase
          .from("stream_destinations")
          .update({ enabled: !current.enabled })
          .eq("id", id)
          .eq("user_id", userId);

        if (error) {
          console.error("Toggle destination error:", error);
          return errorResponse("Failed to toggle destination", 500);
        }

        return new Response(
          JSON.stringify({ success: true, enabled: !current.enabled }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
  } catch (error) {
    console.error("Manage destinations error:", error);
    return errorResponse("Unable to process request", 500);
  }
});
