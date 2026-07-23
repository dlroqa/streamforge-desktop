
# Streaming Architecture

## Current Setup (Daily.co only — no Mux)

The streaming pipeline uses **Daily.co** for everything — WebRTC capture and native RTMP multistreaming.

### Flow
1. User clicks "Go Live"
2. Edge function creates a **Daily.co room** + owner meeting token
3. Edge function fetches **all enabled destinations** and constructs full RTMP URLs (stream_url + stream_key) for each
4. Client joins the Daily room via WebRTC
5. Client calls `startLiveStreaming({ rtmpUrl: [...] })` with all destination RTMP URLs
6. Daily.co sends the browser's video/audio **simultaneously to all destinations** (YouTube, Twitch, Facebook, etc.)

### Multistreaming
Daily.co natively supports multiple RTMP endpoints via the `rtmpUrl` array parameter. All enabled destinations receive the same stream composition. No external relay service needed.

### DB Notes
The `stream_sessions` table still has legacy Mux columns (`mux_stream_id`, `mux_playback_id`, `mux_broadcast_id`). They are unused but harmless. The `mux_space_id` column is repurposed to store the Daily room name for cleanup on stop.
