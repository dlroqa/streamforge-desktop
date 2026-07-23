import { Megaphone, Palette, Wand2 } from 'lucide-react';
import { useStudio } from '@/contexts/StudioContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LowerThirds } from './LowerThirds';
import { PollPanel } from './PollPanel';
import { QAPanel } from './QAPanel';
import { LogoPanel } from './LogoPanel';
import { MotionGraphicsPanel } from './MotionGraphicsPanel';

/**
 * Unified home for the on-stream graphics, grouped into three collapsible
 * sections: "Brand and Title" (logo/watermark + lower thirds), "Call to
 * Action" (polls + Q&A), and "Motion Graphics" (template + AI generator).
 * Each section drops down to reveal the same interface those graphics have
 * always had.
 */

const triggerClass =
  'group w-full rounded-lg border border-border/60 bg-gradient-to-b from-secondary/80 to-secondary/40 px-3 py-2.5 text-sm font-medium shadow-sm ' +
  'transition-all hover:no-underline hover:border-primary/40 hover:from-secondary hover:to-secondary/60 hover:shadow-md ' +
  'data-[state=open]:border-primary/50 data-[state=open]:from-primary/15 data-[state=open]:to-primary/5 data-[state=open]:shadow-md ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [&>svg]:text-muted-foreground';

export function GraphicsPanel() {
  const { graphicsSection, setGraphicsSection } = useStudio();
  return (
    <Accordion type="single" collapsible value={graphicsSection} onValueChange={setGraphicsSection} className="w-full space-y-2">
      <AccordionItem value="brand" className="border-b-0">
        <AccordionTrigger className={triggerClass}>
          <span className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-data-[state=open]:bg-primary/20">
              <Palette className="h-4 w-4" />
            </span>
            Brand and Title
          </span>
        </AccordionTrigger>
        <AccordionContent className="pt-3">
          <Tabs defaultValue="logo" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-8 mb-4">
              <TabsTrigger value="logo" className="text-[11px] px-0.5">Logo</TabsTrigger>
              <TabsTrigger value="lowerthirds" className="text-[11px] px-0.5">Lower 3rd</TabsTrigger>
            </TabsList>
            <TabsContent value="logo" className="mt-0">
              <LogoPanel />
            </TabsContent>
            <TabsContent value="lowerthirds" className="mt-0">
              <LowerThirds />
            </TabsContent>
          </Tabs>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="cta" className="border-b-0">
        <AccordionTrigger className={triggerClass}>
          <span className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-data-[state=open]:bg-primary/20">
              <Megaphone className="h-4 w-4" />
            </span>
            Call to Action
          </span>
        </AccordionTrigger>
        <AccordionContent className="pt-3">
          <Tabs defaultValue="polls" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-8 mb-4">
              <TabsTrigger value="polls" className="text-[11px] px-0.5">Polls</TabsTrigger>
              <TabsTrigger value="qa" className="text-[11px] px-0.5">Q&A</TabsTrigger>
            </TabsList>
            <TabsContent value="polls" className="mt-0">
              <PollPanel />
            </TabsContent>
            <TabsContent value="qa" className="mt-0">
              <QAPanel />
            </TabsContent>
          </Tabs>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="motion" className="border-b-0">
        <AccordionTrigger className={triggerClass}>
          <span className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-data-[state=open]:bg-primary/20">
              <Wand2 className="h-4 w-4" />
            </span>
            Motion Graphics
          </span>
        </AccordionTrigger>
        <AccordionContent className="pt-3">
          <MotionGraphicsPanel />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
