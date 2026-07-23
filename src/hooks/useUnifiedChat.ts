import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Destination } from '@/contexts/StudioContext';

export interface ChatMessage {
  id: string;
  platform: 'twitch' | 'youtube';
  author: string;
  text: string;
  timestamp: Date;
}

export interface ChatSourceStatus {
  platform: 'twitch' | 'youtube';
  channel: string;
  state: 'connecting' | 'connected' | 'error';
  detail?: string;
}

const MAX_MESSAGES = 200;
const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const TWITCH_RECONNECT_MS = 5000;
const YT_MIN_POLL_MS = 5000;

/** Parse a Twitch IRC PRIVMSG line into author + text. */
function parsePrivmsg(line: string): { author: string; text: string } | null {
  // :nick!nick@nick.tmi.twitch.tv PRIVMSG #channel :message text
  const match = line.match(/^:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/);
  if (!match) return null;
  return { author: match[1], text: match[2].trim() };
}

/**
 * Aggregates live chat from the user's stream destinations into one feed:
 * - Twitch: anonymous IRC-over-WebSocket (read-only, no credentials needed).
 * - YouTube: polled via the youtube-chat edge function (server API key).
 * Active only while `enabled` (i.e. while live).
 */
export function useUnifiedChat(destinations: Destination[], enabled: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [statuses, setStatuses] = useState<ChatSourceStatus[]>([]);
  const socketsRef = useRef<WebSocket[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeRef = useRef(false);

  const pushMessages = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages(prev => {
      const seen = new Set(prev.map(m => m.id));
      const fresh = incoming.filter(m => !seen.has(m.id));
      if (!fresh.length) return prev;
      return [...prev, ...fresh].slice(-MAX_MESSAGES);
    });
  }, []);

  const setSourceStatus = useCallback((status: ChatSourceStatus) => {
    setStatuses(prev => [
      ...prev.filter(s => !(s.platform === status.platform && s.channel === status.channel)),
      status,
    ]);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    activeRef.current = true;
    setMessages([]);
    setStatuses([]);

    const twitchChannels = destinations
      .filter(d => d.enabled && d.platform === 'twitch' && d.platformChannelId)
      .map(d => d.platformChannelId!.toLowerCase().replace(/^#/, ''));
    const hasYouTube = destinations.some(
      d => d.enabled && d.platform === 'youtube' && d.platformChannelId,
    );

    // ── Twitch: anonymous IRC websocket per channel ──
    const connectTwitch = (channel: string) => {
      if (!activeRef.current) return;
      setSourceStatus({ platform: 'twitch', channel, state: 'connecting' });
      const ws = new WebSocket(TWITCH_IRC_URL);
      socketsRef.current.push(ws);

      ws.onopen = () => {
        // Anonymous read-only login (justinfan + digits needs no auth)
        ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
        ws.send(`JOIN #${channel}`);
        setSourceStatus({ platform: 'twitch', channel, state: 'connected' });
      };

      ws.onmessage = event => {
        const lines = String(event.data).split('\r\n').filter(Boolean);
        const parsed: ChatMessage[] = [];
        for (const line of lines) {
          if (line.startsWith('PING')) {
            ws.send('PONG :tmi.twitch.tv');
            continue;
          }
          const msg = parsePrivmsg(line);
          if (msg) {
            parsed.push({
              id: crypto.randomUUID(),
              platform: 'twitch',
              author: msg.author,
              text: msg.text,
              timestamp: new Date(),
            });
          }
        }
        pushMessages(parsed);
      };

      ws.onclose = () => {
        socketsRef.current = socketsRef.current.filter(s => s !== ws);
        if (activeRef.current) {
          setSourceStatus({ platform: 'twitch', channel, state: 'connecting', detail: 'Reconnecting…' });
          const timer = setTimeout(() => connectTwitch(channel), TWITCH_RECONNECT_MS);
          timersRef.current.push(timer);
        }
      };

      ws.onerror = () => {
        setSourceStatus({ platform: 'twitch', channel, state: 'error', detail: 'Connection error' });
      };
    };

    twitchChannels.forEach(connectTwitch);

    // ── YouTube: poll the edge function, honoring its polling interval ──
    let liveChatId: string | null = null;
    let pageToken: string | null = null;

    const pollYouTube = async () => {
      if (!activeRef.current) return;
      try {
        const { data, error } = await supabase.functions.invoke('youtube-chat', {
          body: { live_chat_id: liveChatId, page_token: pageToken },
        });
        if (!activeRef.current) return;

        if (error || !data?.success) {
          if (data?.chat_ended) {
            // Broadcast chat rotated — re-resolve from scratch next poll
            liveChatId = null;
            pageToken = null;
          }
          setSourceStatus({
            platform: 'youtube',
            channel: 'YouTube',
            state: 'error',
            detail: data?.error || error?.message || 'Unavailable',
          });
          const timer = setTimeout(pollYouTube, 15000);
          timersRef.current.push(timer);
          return;
        }

        liveChatId = data.live_chat_id ?? liveChatId;
        pageToken = data.next_page_token ?? null;
        setSourceStatus({ platform: 'youtube', channel: 'YouTube', state: 'connected' });

        pushMessages(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data.messages ?? []).map((m: any) => ({
            id: `yt-${m.id}`,
            platform: 'youtube' as const,
            author: m.author,
            text: m.text,
            timestamp: m.published_at ? new Date(m.published_at) : new Date(),
          })),
        );

        const interval = Math.max(YT_MIN_POLL_MS, Number(data.polling_interval_ms) || YT_MIN_POLL_MS);
        const timer = setTimeout(pollYouTube, interval);
        timersRef.current.push(timer);
      } catch {
        if (!activeRef.current) return;
        const timer = setTimeout(pollYouTube, 15000);
        timersRef.current.push(timer);
      }
    };

    if (hasYouTube) {
      setSourceStatus({ platform: 'youtube', channel: 'YouTube', state: 'connecting' });
      pollYouTube();
    }

    return () => {
      activeRef.current = false;
      socketsRef.current.forEach(ws => {
        try { ws.close(); } catch { /* already closed */ }
      });
      socketsRef.current = [];
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      setStatuses([]);
    };
    // Reconnect chat when the destination set changes while live
  }, [enabled, destinations, pushMessages, setSourceStatus]);

  return { chatMessages: messages, chatStatuses: statuses };
}
