// "Forge Chat" — a private backstage chat between the host and invited guests,
// carried over Daily's app-message channel (peer-to-peer, no backend). It is
// deliberately separate from the public stream chat (YouTube/Twitch/etc.) so a
// host can talk to guests without it going out to viewers.

export interface ForgeChatMessage {
  id: string;
  author: string;
  text: string;
  /** true if this client sent it (render right-aligned) */
  mine: boolean;
  timestamp: Date;
}

/** app-message discriminator + wire shape sent via Daily sendAppMessage. */
export const FORGE_CHAT_TYPE = 'forge-chat';

export interface ForgeChatWire {
  t: typeof FORGE_CHAT_TYPE;
  id: string;
  author: string;
  text: string;
}

export const FORGE_CHAT_MAX = 200;

export function isForgeChatWire(data: unknown): data is ForgeChatWire {
  return !!data && typeof data === 'object'
    && (data as { t?: unknown }).t === FORGE_CHAT_TYPE
    && typeof (data as ForgeChatWire).text === 'string'
    && typeof (data as ForgeChatWire).id === 'string';
}
