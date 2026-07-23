import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RecordingSettings } from './RecordingSettings';
import { VideoLibrary } from './VideoLibrary';
import { StreamScheduler } from './StreamScheduler';

/**
 * Unified home for recording, the video library, and stream scheduling.
 * One sidebar entry instead of three.
 */
export function ArchivePanel() {
  return (
    <Tabs defaultValue="recording" className="w-full">
      <TabsList className="grid w-full grid-cols-3 h-8 mb-4">
        <TabsTrigger value="recording" className="text-xs px-1">Recording</TabsTrigger>
        <TabsTrigger value="library" className="text-xs px-1">Library</TabsTrigger>
        <TabsTrigger value="scheduler" className="text-xs px-1">Scheduler</TabsTrigger>
      </TabsList>
      <TabsContent value="recording" className="mt-0">
        <RecordingSettings />
      </TabsContent>
      <TabsContent value="library" className="mt-0">
        <VideoLibrary />
      </TabsContent>
      <TabsContent value="scheduler" className="mt-0">
        <StreamScheduler />
      </TabsContent>
    </Tabs>
  );
}
