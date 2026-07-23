import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Radio, Send } from 'lucide-react';
import type { ForgeChatMessage } from '@/lib/forgeChat';

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Presentational backstage-chat feed + composer, shared by the host studio and
 * the invited-guest studio so both look identical. Branded "Forge Chat" to make
 * clear it is the platform's private channel, not a connected stream chat.
 */
export function ForgeChatView({
  messages, onSend, subtitle, disabled, emptyHint, headerAction,
}: {
  messages: ForgeChatMessage[];
  onSend: (text: string) => void;
  /** e.g. the guest name (host view) or "with {host}" (guest view). */
  subtitle?: string;
  disabled?: boolean;
  emptyHint?: string;
  /** Optional header control (e.g. the host's alert-sound settings). */
  headerAction?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Branded header — distinguishes this from platform chats */}
      <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-2">
        <span className="h-5 w-5 rounded-md bg-primary flex items-center justify-center shrink-0">
          <Radio className="h-3 w-3 text-primary-foreground" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground leading-tight">Forge Chat</p>
          {subtitle && <p className="text-[11px] text-muted-foreground truncate leading-tight">{subtitle}</p>}
        </div>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {headerAction}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Private</span>
        </div>
      </div>

      {/* Feed */}
      <div ref={feedRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 text-center py-6">
            {emptyHint || 'No messages yet. Say hello — only people in this studio see it.'}
          </p>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`flex flex-col ${msg.mine ? 'items-end' : 'items-start'}`}>
              {!msg.mine && <span className="text-[11px] text-muted-foreground px-1 mb-0.5">{msg.author}</span>}
              <div
                className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm leading-snug break-words ${
                  msg.mine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
                }`}
              >
                {msg.text}
              </div>
              <span className="text-[10px] text-muted-foreground/50 font-mono px-1 mt-0.5">
                {formatTime(msg.timestamp)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-2 shrink-0 flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
          placeholder={disabled ? 'Chat available when live' : 'Message the studio…'}
          disabled={disabled}
          maxLength={500}
          className="flex-1 bg-secondary/60 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={disabled || !draft.trim()}
          className="h-9 w-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors shrink-0"
          title="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
