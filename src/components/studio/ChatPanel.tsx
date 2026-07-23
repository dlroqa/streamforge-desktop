import { useStudio } from '@/contexts/StudioContext';
import { PlatformIcon } from './PlatformIcon';
import { ForgeChatView } from './ForgeChatView';
import { ForgeChatSoundControls } from './ForgeChatSoundControls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MessagesSquare, MessageCircleQuestion } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel() {
  const {
    isLive, isBackstage, chatMessages, chatStatuses, addQuestion, destinations,
    forgeChat, sendForgeChat, guests, forgeChatUnread, markForgeChatRead,
    forgeChatSoundMuted, forgeChatSoundVolume, toggleForgeChatSound, setForgeChatSoundVolume,
  } = useStudio();
  const feedRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [chatTab, setChatTab] = useState('stream');

  // Viewing the Forge Chat tab marks its messages read (clears the badge),
  // and keeps clearing as new ones arrive while it's open.
  useEffect(() => {
    // The Forge tab (live) or the backstage-only Forge view (pre-live) both show
    // the Forge Chat, so seeing either marks its messages read.
    if (chatTab === 'forge' || (isBackstage && !isLive)) markForgeChatRead();
  }, [chatTab, forgeChat, isBackstage, isLive, markForgeChatRead]);

  // Follow the feed unless the user scrolled up to read history
  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [chatMessages, autoScroll]);

  const handleScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const chatCapable = destinations.some(
    d => d.enabled && d.platformChannelId && (d.platform === 'twitch' || d.platform === 'youtube'),
  );

  const guestNames = guests.map(g => g.userName).join(', ');

  // Before going live: public stream chat isn't connected yet, but the private
  // backstage Forge Chat works as soon as the host enters the waiting room — so
  // host and guests can talk while prepping. Show just the Forge Chat then.
  if (!isLive) {
    if (isBackstage) {
      return (
        <div className="flex flex-col h-full">
          <div className="px-3 pt-3 pb-2 shrink-0 border-b border-border">
            <p className="text-xs font-semibold text-foreground">Forge Chat</p>
            <p className="text-[11px] text-muted-foreground/70">Waiting room — public stream chat connects when you go live.</p>
          </div>
          <div className="flex-1 overflow-hidden">
            <ForgeChatView
              messages={forgeChat}
              onSend={sendForgeChat}
              subtitle={guests.length ? guestNames : 'No guests connected yet'}
              emptyHint="Private backstage chat with your guests — viewers never see this."
              headerAction={
                <ForgeChatSoundControls
                  muted={forgeChatSoundMuted}
                  volume={forgeChatSoundVolume}
                  onToggle={toggleForgeChatSound}
                  onVolumeChange={setForgeChatSoundVolume}
                  description="Chime when an invited guest sends a Forge Chat message."
                />
              }
            />
          </div>
        </div>
      );
    }
    return (
      <div className="text-center py-8 px-4 space-y-3">
        <MessagesSquare className="h-8 w-8 text-muted-foreground/30 mx-auto" />
        <div>
          <p className="text-sm text-muted-foreground">Chat connects when you go live</p>
          <p className="text-xs text-muted-foreground/60 mt-1 leading-relaxed px-2">
            Messages from your Twitch and YouTube channels appear here in one
            feed. Add the channel name / ID on each destination to enable it.
          </p>
          <p className="text-xs text-muted-foreground/60 mt-2 leading-relaxed px-2">
            Enter the waiting room to chat privately with invited guests first.
          </p>
        </div>
      </div>
    );
  }

  const forgeUnseen = forgeChatUnread > 0 && chatTab !== 'forge';

  return (
    <Tabs value={chatTab} onValueChange={setChatTab} className="flex flex-col h-full">
      <div className="px-3 pt-3 shrink-0">
        <TabsList className="grid w-full grid-cols-2 h-8">
          <TabsTrigger value="stream" className="text-xs">Stream Chat</TabsTrigger>
          <TabsTrigger value="forge" className="text-xs relative">
            Forge Chat
            {forgeUnseen && (
              <span className="ml-1.5 h-2 w-2 rounded-full bg-live animate-pulse-live" />
            )}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="stream" className="mt-0 flex-1 overflow-hidden">
        <div className="flex flex-col h-full">
      {/* Source status */}
      <div className="px-4 py-2 border-b border-border space-y-1 shrink-0">
        {chatStatuses.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {chatCapable ? 'Connecting…' : 'No chat-capable destinations. Add a Twitch username or YouTube channel ID to a destination.'}
          </p>
        )}
        {chatStatuses.map(s => (
          <div key={`${s.platform}-${s.channel}`} className="flex items-center gap-2 text-xs">
            <PlatformIcon platform={s.platform} className="h-3.5 w-3.5" />
            <span className="text-foreground truncate">{s.channel}</span>
            <span
              className={
                s.state === 'connected'
                  ? 'text-success'
                  : s.state === 'error'
                    ? 'text-destructive'
                    : 'text-muted-foreground'
              }
            >
              {s.state === 'connected' ? '● live' : s.detail || s.state}
            </span>
          </div>
        ))}
      </div>

      {/* Feed */}
      <div ref={feedRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
        {chatMessages.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 text-center py-6">
            Waiting for messages…
          </p>
        ) : (
          chatMessages.map(msg => (
            <div key={msg.id} className="group flex items-start gap-2">
              <PlatformIcon platform={msg.platform} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-foreground truncate">{msg.author}</span>
                  <span className="text-[11px] text-muted-foreground/60 font-mono shrink-0">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-foreground/90 leading-snug break-words">{msg.text}</p>
              </div>
              <button
                onClick={() =>
                  addQuestion({
                    author: msg.author,
                    platform: msg.platform === 'twitch' ? 'Twitch' : 'YouTube',
                    text: msg.text,
                  })
                }
                className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-primary transition-colors shrink-0"
                title="Add to Q&A"
              >
                <MessageCircleQuestion className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
        </div>
      </TabsContent>

      <TabsContent value="forge" className="mt-0 flex-1 overflow-hidden">
        <ForgeChatView
          messages={forgeChat}
          onSend={sendForgeChat}
          subtitle={guests.length ? guestNames : 'No guests connected yet'}
          emptyHint="Private backstage chat with your guests — viewers never see this."
          headerAction={
            <ForgeChatSoundControls
              muted={forgeChatSoundMuted}
              volume={forgeChatSoundVolume}
              onToggle={toggleForgeChatSound}
              onVolumeChange={setForgeChatSoundVolume}
              description="Chime when an invited guest sends a Forge Chat message."
            />
          }
        />
      </TabsContent>
    </Tabs>
  );
}
