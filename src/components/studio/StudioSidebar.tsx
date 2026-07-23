import { useStudio, type SidebarPanel } from '@/contexts/StudioContext';
import { useAuth, sidebarOrderOf } from '@/contexts/AuthContext';
import {
  Layers, Archive, Gauge, Images, Film, Headset,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEffect, useRef, useState } from 'react';

// 'editor' opens the standalone /editor window instead of a side panel.
type SidebarId = SidebarPanel | 'editor';
const sidebarItems: { id: SidebarId; icon: React.ElementType; label: string }[] = [
  { id: 'pro', icon: Gauge, label: 'Pro Control' },
  { id: 'editor', icon: Film, label: 'Video Editor' },
  { id: 'graphics', icon: Layers, label: 'Graphic Interface' },
  { id: 'controlroom', icon: Headset, label: 'Control Room' },
  { id: 'stock', icon: Images, label: 'Media Library' },
  { id: 'archive', icon: Archive, label: 'Archive Tools' },
];

const DEFAULT_ORDER = sidebarItems.map(i => i.id);
const itemsById = new Map(sidebarItems.map(i => [i.id, i]));

/** Reconcile a saved order against the current menu set: keep the user's
 * sequence, drop ids that no longer exist, and append any newly-added menus at
 * the end so future features never vanish behind a stale preference. */
function mergeOrder(saved: string[] | null): SidebarId[] {
  const seen = new Set<string>();
  const result: SidebarId[] = [];
  for (const id of saved ?? []) {
    if (itemsById.has(id as SidebarId) && !seen.has(id)) {
      result.push(id as SidebarId);
      seen.add(id);
    }
  }
  for (const id of DEFAULT_ORDER) if (!seen.has(id)) result.push(id);
  return result;
}

// Named window: re-clicking focuses the existing editor instead of
// spawning duplicates. Minimal-chrome features hide the toolbar/menubar;
// browsers still pin a read-only origin strip for anti-phishing, but the
// route itself is auth-protected so a copied URL is useless when signed out.
// (Activity tracking happens inside the Editor page itself.)
function openEditorWindow() {
  window.open(
    '/editor',
    'streamforge-editor',
    'popup=yes,width=1400,height=900,location=no,toolbar=no,menubar=no,status=no',
  );
}

export function StudioSidebar() {
  const { activePanel, setActivePanel } = useStudio();
  const { user, updateSidebarOrder } = useAuth();

  // Local, optimistic order. Seeded from the account's saved arrangement and
  // re-synced whenever the account's stored order changes (initial load, or a
  // reorder made on another device).
  const [order, setOrder] = useState<SidebarId[]>(() => mergeOrder(sidebarOrderOf(user)));
  const orderRef = useRef(order);
  useEffect(() => { orderRef.current = order; }, [order]);
  useEffect(() => { setOrder(mergeOrder(sidebarOrderOf(user))); }, [user]);

  // Drag state: a ref drives the live reorder (fresh inside dragover handlers),
  // a state mirror drives the "lifted" styling.
  const dragId = useRef<SidebarId | null>(null);
  const [draggingId, setDraggingId] = useState<SidebarId | null>(null);

  const persist = (next: SidebarId[]) => { void updateSidebarOrder(next); };

  const reorder = (from: SidebarId, to: SidebarId) => {
    if (from === to) return;
    setOrder(prev => {
      const fi = prev.indexOf(from), ti = prev.indexOf(to);
      if (fi < 0 || ti < 0) return prev;
      const next = [...prev];
      next.splice(ti, 0, next.splice(fi, 1)[0]);
      return next;
    });
  };

  // Keyboard alternative to dragging: Alt+↑/↓ nudges the focused menu.
  const move = (id: SidebarId, dir: -1 | 1) => {
    const prev = orderRef.current;
    const i = prev.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= prev.length) return;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    persist(next);
  };

  const endDrag = () => {
    dragId.current = null;
    setDraggingId(null);
    persist(orderRef.current);
  };

  return (
    <aside className="w-14 border-l border-border bg-sidebar flex flex-col items-center py-3 gap-1 shrink-0">
      {order.map(id => {
        const item = itemsById.get(id);
        if (!item) return null;
        const isActive = activePanel === item.id;
        const isDragging = draggingId === item.id;
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                draggable
                onDragStart={e => {
                  dragId.current = item.id;
                  setDraggingId(item.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={e => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragId.current) reorder(dragId.current, item.id);
                }}
                onDrop={e => e.preventDefault()}
                onDragEnd={endDrag}
                onKeyDown={e => {
                  if (!e.altKey) return;
                  if (e.key === 'ArrowUp') { e.preventDefault(); move(item.id, -1); }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); move(item.id, 1); }
                }}
                onClick={() =>
                  item.id === 'editor'
                    ? openEditorWindow()
                    : setActivePanel(isActive ? null : (item.id as SidebarPanel))
                }
                aria-label={item.label}
                title={item.label}
                className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-150 cursor-grab active:cursor-grabbing ${
                  isDragging
                    ? 'opacity-40 scale-95'
                    : isActive
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
              >
                <item.icon className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={8}>
              <p>{item.label}</p>
              <p className="text-[10px] text-muted-foreground">Drag to reorder · Alt+↑/↓</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </aside>
  );
}
