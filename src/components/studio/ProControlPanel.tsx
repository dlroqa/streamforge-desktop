import { Gauge } from 'lucide-react';

/**
 * Pro Control — advanced broadcast controls. Scaffold for now; features get
 * added here as they're specified.
 */
export function ProControlPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Gauge className="h-4 w-4 text-primary" />
        Pro Control
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        More advanced broadcast controls will live here.
      </p>
    </div>
  );
}
