import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SourceManager } from './SourceManager';
import { StreamDestinations } from './StreamDestinations';
import { AudioMixer } from './AudioMixer';
import { MusicPanel } from './MusicPanel';
import { AudioEffectsPanel } from './AudioEffectsPanel';
import { VideoFilterPanel } from './VideoFilterPanel';

/**
 * Unified audio/video configuration: capture sources, stream destinations,
 * audio mixing, and video filters. One sidebar entry instead of four.
 */
export function AVSettingsPanel() {
  return (
    <Tabs defaultValue="sources" className="w-full">
      <TabsList className="grid w-full grid-cols-4 h-8 mb-4">
        <TabsTrigger value="sources" className="text-xs px-0.5">Video</TabsTrigger>
        <TabsTrigger value="filters" className="text-xs px-0.5">Filters</TabsTrigger>
        <TabsTrigger value="audio" className="text-xs px-0.5">Audio</TabsTrigger>
        <TabsTrigger value="destinations" className="text-xs px-0.5">Outputs</TabsTrigger>
      </TabsList>
      <TabsContent value="sources" className="mt-0">
        <SourceManager />
      </TabsContent>
      <TabsContent value="destinations" className="mt-0">
        <StreamDestinations />
      </TabsContent>
      <TabsContent value="audio" className="mt-0">
        <AudioMixer />
        <MusicPanel />
        <AudioEffectsPanel />
      </TabsContent>
      <TabsContent value="filters" className="mt-0">
        <VideoFilterPanel />
      </TabsContent>
    </Tabs>
  );
}
