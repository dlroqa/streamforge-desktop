import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GuestsPanel } from './GuestsPanel';
import { ChatPanel } from './ChatPanel';
import { useStudio } from '@/contexts/StudioContext';

/**
 * Audience & participant interaction: guest invites and the unified chat
 * feed. One sidebar entry instead of two.
 *
 * Fills the panel height itself (registered as self-scrolling in
 * StudioLayout): the Guests tab scrolls normally, while the Chat tab hands
 * full height to ChatPanel's own sticky-header + auto-scroll feed.
 */
export function InteractPanel() {
  const { forgeChatUnread } = useStudio();
  return (
    <Tabs defaultValue="guests" className="flex flex-col h-full">
      <div className="px-4 pt-4 shrink-0">
        <TabsList className="grid w-full grid-cols-2 h-8">
          <TabsTrigger value="guests" className="text-xs">Guests</TabsTrigger>
          <TabsTrigger value="chat" className="text-xs relative">
            Chat
            {forgeChatUnread > 0 && (
              <span className="ml-1.5 h-2 w-2 rounded-full bg-live animate-pulse-live" />
            )}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="guests" className="mt-0 flex-1 overflow-y-auto p-4">
        <GuestsPanel />
      </TabsContent>
      <TabsContent value="chat" className="mt-0 flex-1 overflow-hidden">
        <ChatPanel />
      </TabsContent>
    </Tabs>
  );
}
