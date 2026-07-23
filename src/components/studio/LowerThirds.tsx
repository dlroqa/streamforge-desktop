import {
  useStudio, LOWER_THIRD_FONTS, DEFAULT_LOWER_THIRD_STYLE, lowerThirdFontStack,
  type LowerThirdShape, type LowerThirdStyle, type LowerThirdAlign,
} from '@/contexts/StudioContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Eye, EyeOff, RotateCcw, Type, Squircle, Pill, Plus, Trash2,
  AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline,
} from 'lucide-react';
import { useState, useEffect } from 'react';

const SHAPES: Array<{ id: LowerThirdShape; label: string; icon: React.ElementType }> = [
  { id: 'none', label: 'Text Only', icon: Type },
  { id: 'rounded', label: 'Rounded', icon: Squircle },
  { id: 'pill', label: 'Pill', icon: Pill },
];

const ALIGNMENTS: Array<{ id: LowerThirdAlign; label: string; icon: React.ElementType }> = [
  { id: 'left', label: 'Left', icon: AlignLeft },
  { id: 'center', label: 'Center', icon: AlignCenter },
  { id: 'right', label: 'Right', icon: AlignRight },
];

const TEXT_STYLES: Array<{ key: 'bold' | 'italic' | 'underline'; label: string; icon: React.ElementType }> = [
  { key: 'bold', label: 'Bold', icon: Bold },
  { key: 'italic', label: 'Italic', icon: Italic },
  { key: 'underline', label: 'Underline', icon: Underline },
];

function ColorField({ label, value, onChange }: {
  label: string; value: string; onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-6 w-10 rounded border border-border bg-transparent cursor-pointer"
        title={label}
      />
    </div>
  );
}

export function LowerThirds() {
  const {
    lowerThirds, activeLowerThirdId, addLowerThird, removeLowerThird,
    updateLowerThirdItem, cueLowerThird, setPreviewLowerThirdId,
  } = useStudio();

  const [selectedId, setSelectedId] = useState<string | null>(lowerThirds[0]?.id ?? null);
  const selected = lowerThirds.find(l => l.id === selectedId) ?? lowerThirds[0] ?? null;

  // Show the selected item as a temporary placeholder on the video preview
  // while this editor is open; clear it when the editor closes.
  useEffect(() => {
    setPreviewLowerThirdId(selected?.id ?? null);
    return () => setPreviewLowerThirdId(null);
  }, [selected?.id, setPreviewLowerThirdId]);

  if (!selected) {
    return (
      <div className="space-y-3">
        <Button size="sm" onClick={() => setSelectedId(addLowerThird())} className="w-full gap-2">
          <Plus className="h-3.5 w-3.5" /> Add Lower Third
        </Button>
      </div>
    );
  }

  const style = selected.style;
  const setStyle = (patch: Partial<LowerThirdStyle>) =>
    updateLowerThirdItem(selected.id, { style: patch as LowerThirdStyle });
  const isDefaultStyle = JSON.stringify(style) === JSON.stringify(DEFAULT_LOWER_THIRD_STYLE);
  // A single "Text Size" scales title and subtitle together, keeping the
  // default proportion between them.
  const subtitleRatio = DEFAULT_LOWER_THIRD_STYLE.subtitleSize / DEFAULT_LOWER_THIRD_STYLE.titleSize;
  const textOnly = style.shape !== 'rounded' && style.shape !== 'pill';
  const radius = style.shape === 'pill' ? 999 : 10;
  const previewTextStyle = {
    fontFamily: lowerThirdFontStack(style.font),
    textAlign: style.align,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    ...(textOnly ? { textShadow: '0 2px 8px rgba(0,0,0,0.75)' } : {}),
  } as const;

  return (
    <div className="space-y-4">
      {/* Deck */}
      <div className="space-y-1.5">
        {lowerThirds.map((item, i) => {
          const onAir = item.id === activeLowerThirdId;
          const isSelected = item.id === selected.id;
          return (
            <div
              key={item.id}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
                isSelected ? 'border-primary/60 bg-primary/5' : 'border-border bg-secondary/30 hover:bg-secondary/50'
              }`}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="text-xs font-medium text-foreground truncate flex-1">
                {item.title || `Lower third ${i + 1}`}
                {onAir && (
                  <span className="ml-2 text-[10px] font-bold text-live tracking-wider">● ON AIR</span>
                )}
              </span>
              <Button
                size="sm"
                variant={onAir ? 'destructive' : 'secondary'}
                className="h-6 px-2 text-[11px] gap-1 shrink-0"
                onClick={e => {
                  e.stopPropagation();
                  cueLowerThird(onAir ? null : item.id);
                }}
                disabled={!onAir && !item.title}
                title={onAir ? 'Take off air' : item.title ? 'Cue on air' : 'Add a title first'}
              >
                {onAir ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {onAir ? 'Hide' : 'Cue'}
              </Button>
              {lowerThirds.length > 1 && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (selectedId === item.id) {
                      setSelectedId(lowerThirds.find(l => l.id !== item.id)?.id ?? null);
                    }
                    removeLowerThird(item.id);
                  }}
                  className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSelectedId(addLowerThird())}
          className="w-full gap-2 text-xs"
        >
          <Plus className="h-3.5 w-3.5" /> Add Lower Third
        </Button>
        <p className="text-[11px] text-muted-foreground">
          One lower third is on air at a time — cueing another swaps instantly.
        </p>
      </div>

      {/* Editor for the selected item */}
      <div className="border-t border-border pt-4 space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Title</label>
          <Input
            placeholder="Main title text"
            value={selected.title}
            onChange={e => updateLowerThirdItem(selected.id, { title: e.target.value })}
            className="text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Subtitle</label>
          <Input
            placeholder="Subtitle or description"
            value={selected.subtitle}
            onChange={e => updateLowerThirdItem(selected.id, { subtitle: e.target.value })}
            className="text-sm"
          />
        </div>

        {/* Preview — right under the title/subtitle fields */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Preview</h3>
          <div className="bg-gradient-to-br from-slate-700 to-slate-900 rounded-lg p-4 min-h-[80px] flex items-end border border-border/50">
            {selected.title ? (
              <div className="w-full">
                <div
                  className={textOnly ? 'relative' : 'relative overflow-hidden'}
                  style={textOnly ? { padding: '8px 12px' } : {
                    backgroundColor: `${style.bgColor}F2`,
                    borderRadius: radius,
                    padding: '10px 16px 14px',
                  }}
                >
                  {!textOnly && (
                    <div
                      className="absolute left-0 right-0 bottom-0 h-1"
                      style={{ backgroundColor: style.accentColor }}
                    />
                  )}
                  <p
                    className="leading-tight"
                    style={{ ...previewTextStyle, color: style.textColor, fontSize: style.titleSize * 0.5 }}
                  >
                    {selected.title}
                  </p>
                  {selected.subtitle && (
                    <p
                      className="mt-0.5"
                      style={{ ...previewTextStyle, color: `${style.textColor}BF`, fontSize: style.subtitleSize * 0.5, fontWeight: style.bold ? 600 : 400 }}
                    >
                      {selected.subtitle}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground w-full text-center">Enter a title above to preview</p>
            )}
          </div>
        </div>

        {/* Appearance */}
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Appearance</h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStyle(DEFAULT_LOWER_THIRD_STYLE)}
            disabled={isDefaultStyle}
            className="h-6 gap-1 px-2 text-[11px]"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
        </div>

        {/* Shape */}
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Shape</label>
          <div className="grid grid-cols-3 gap-1.5">
            {SHAPES.map(s => (
              <button
                key={s.id}
                onClick={() => setStyle({ shape: s.id })}
                className={`flex flex-col items-center gap-1 py-2 rounded-md text-[11px] font-medium transition-colors ${
                  style.shape === s.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                <s.icon className="h-4 w-4" />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Font — directly under the shape options */}
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Font</label>
          <Select value={style.font} onValueChange={v => setStyle({ font: v as LowerThirdStyle['font'] })}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOWER_THIRD_FONTS.map(f => (
                <SelectItem key={f.id} value={f.id} className="text-xs" style={{ fontFamily: f.stack }}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bold / Italic / Underline */}
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Style</label>
          <div className="grid grid-cols-3 gap-1.5">
            {TEXT_STYLES.map(t => (
              <button
                key={t.key}
                onClick={() => setStyle({ [t.key]: !style[t.key] })}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                  style[t.key]
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
                title={t.label}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Text alignment — under the Bold/Italic/Underline options */}
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Text Alignment</label>
          <div className="grid grid-cols-3 gap-1.5">
            {ALIGNMENTS.map(a => (
              <button
                key={a.id}
                onClick={() => setStyle({ align: a.id })}
                className={`flex flex-col items-center gap-1 py-2 rounded-md text-[11px] font-medium transition-colors ${
                  style.align === a.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                <a.icon className="h-4 w-4" />
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Text Size — scales the title and subtitle together */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Text Size</span>
            <span className="text-[11px] font-mono text-muted-foreground">{style.titleSize}px</span>
          </div>
          <Slider
            value={[style.titleSize]}
            min={18} max={100} step={1}
            onValueChange={([v]) => setStyle({ titleSize: v, subtitleSize: Math.max(10, Math.round(v * subtitleRatio)) })}
          />
        </div>

        {/* Colors */}
        <div className="space-y-1">
          <ColorField label="Background" value={style.bgColor} onChange={c => setStyle({ bgColor: c })} />
          <ColorField label="Text" value={style.textColor} onChange={c => setStyle({ textColor: c })} />
          <ColorField label="Accent" value={style.accentColor} onChange={c => setStyle({ accentColor: c })} />
        </div>
      </div>
    </div>
  );
}
