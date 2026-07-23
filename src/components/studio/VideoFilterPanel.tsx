import { useStudio, NEUTRAL_GRADE, type VideoFilter, type ColorGrade, type ParsedLut } from '@/contexts/StudioContext';
import { LutRenderer, type LutRecipe } from '@/lib/lut';
import { downloadCubeLut } from '@/lib/lutExport';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RotateCcw, Upload, Download, Loader2, Eye, EyeOff, Plus, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface SavedLook {
  id: string;
  name: string;
  filter: VideoFilter;
  grade: ColorGrade;
}

const MAX_LOOKS = 5;

function loadLooks(): SavedLook[] {
  try {
    const raw = localStorage.getItem('studio-looks');
    const parsed = raw ? (JSON.parse(raw) as SavedLook[]) : null;
    if (Array.isArray(parsed)) return parsed.slice(0, MAX_LOOKS);
  } catch { /* fresh start */ }
  return [];
}

function sameLook(filter: VideoFilter, grade: ColorGrade, look: SavedLook): boolean {
  if (look.filter !== filter) return false;
  return (Object.keys(NEUTRAL_GRADE) as Array<keyof ColorGrade>).every(
    key => grade[key] === look.grade[key],
  );
}

/** Renders a test gradient through the real WebGL LUT pipeline so the user
 * sees the grade immediately, before/after side by side. */
function LutThumbnail({ lut }: { lut: ParsedLut }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Test card: hue sweep with vertical luma ramp
    const test = document.createElement('canvas');
    test.width = 128; test.height = 64;
    const tctx = test.getContext('2d')!;
    const hueGrad = tctx.createLinearGradient(0, 0, 128, 0);
    for (let i = 0; i <= 6; i++) hueGrad.addColorStop(i / 6, `hsl(${i * 60}, 90%, 55%)`);
    tctx.fillStyle = hueGrad;
    tctx.fillRect(0, 0, 128, 64);
    const lumaGrad = tctx.createLinearGradient(0, 0, 0, 64);
    lumaGrad.addColorStop(0, 'rgba(255,255,255,0.85)');
    lumaGrad.addColorStop(0.5, 'rgba(0,0,0,0)');
    lumaGrad.addColorStop(1, 'rgba(0,0,0,0.85)');
    tctx.fillStyle = lumaGrad;
    tctx.fillRect(0, 0, 128, 64);

    // Left half: original · Right half: through the LUT
    ctx.drawImage(test, 0, 0, 64, 64, 0, 0, 64, 64);
    let renderer: LutRenderer | null = null;
    try {
      renderer = new LutRenderer();
      renderer.setLut(lut);
      if (!renderer.selfTest()) throw new Error('LUT self-test rendered black');
      const graded = renderer.process(test, 128, 64);
      ctx.drawImage(graded, 64, 0, 64, 64, 64, 0, 64, 64);
    } catch (err) {
      console.error('LUT thumbnail unavailable:', err);
      // Show the untouched card rather than a black box
      ctx.drawImage(test, 64, 0, 64, 64, 64, 0, 64, 64);
    } finally {
      renderer?.dispose();
    }
  }, [lut]);

  return (
    <div>
      <canvas ref={canvasRef} width={128} height={64} className="w-full rounded-md border border-border" />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5 px-1">
        <span>Original</span><span>With LUT</span>
      </div>
    </div>
  );
}

const filters: { id: VideoFilter; name: string; css: string }[] = [
  { id: 'none', name: 'None', css: '' },
  { id: 'grayscale', name: 'B&W', css: 'grayscale(100%)' },
  { id: 'sepia', name: 'Sepia', css: 'sepia(80%)' },
  { id: 'contrast', name: 'High Contrast', css: 'contrast(150%) brightness(110%)' },
  { id: 'warm', name: 'Warm', css: 'sepia(30%) saturate(140%) brightness(105%)' },
  { id: 'cool', name: 'Cool', css: 'hue-rotate(30deg) saturate(120%)' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(50%) contrast(90%) brightness(90%)' },
  { id: 'dramatic', name: 'Dramatic', css: 'contrast(170%) brightness(80%) saturate(130%)' },
];

type SliderKey = 'gamma' | 'brightness' | 'contrast' | 'saturation' | 'hue' | 'opacity';

const SLIDERS: Array<{
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}> = [
  { key: 'gamma', label: 'Gamma', min: 0.2, max: 2.5, step: 0.05, format: v => v.toFixed(2) },
  { key: 'brightness', label: 'Brightness', min: 0, max: 200, step: 1, format: v => `${v}%` },
  { key: 'contrast', label: 'Contrast', min: 0, max: 200, step: 1, format: v => `${v}%` },
  { key: 'saturation', label: 'Saturation', min: 0, max: 200, step: 1, format: v => `${v}%` },
  { key: 'hue', label: 'Hue Shift', min: -180, max: 180, step: 1, format: v => `${v}°` },
  { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, format: v => `${v}%` },
];

function GradeSlider({
  def, value, onChange, neutral,
}: {
  def: typeof SLIDERS[number];
  value: number;
  onChange: (v: number) => void;
  neutral: number;
}) {
  const changed = value !== neutral;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs ${changed ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
          {def.label}
        </span>
        <button
          onClick={() => onChange(neutral)}
          className={`text-[11px] font-mono tabular-nums ${changed ? 'text-primary hover:underline' : 'text-muted-foreground/60'}`}
          title={changed ? 'Reset to neutral' : undefined}
        >
          {def.format(value)}
        </button>
      </div>
      <Slider
        value={[value]}
        min={def.min}
        max={def.max}
        step={def.step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

function ColorBlendRow({
  label, enabled, color, onToggle, onColor,
}: {
  label: string;
  enabled: boolean;
  color: string;
  onToggle: (v: boolean) => void;
  onColor: (c: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-md bg-secondary/30">
      <span className={`text-xs ${enabled ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={color}
          onChange={e => onColor(e.target.value)}
          disabled={!enabled}
          className="h-6 w-8 rounded border border-border bg-transparent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title={`${label} color`}
        />
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
    </div>
  );
}

/** Metrics a platform-made LUT was crafted from — the exact filter and
 * correction values baked into the table, shown as a baseline so the user
 * knows how much of each adjustment the LUT already contains. */
function LutRecipeCard({ recipe, onAdjust }: { recipe: LutRecipe; onAdjust: () => void }) {
  const g = recipe.grade;
  const filterName = filters.find(f => f.id === recipe.filter)?.name ?? recipe.filter;
  const metrics: [string, string][] = [
    ['Filter', filterName],
    ['Gamma', `${g.gamma ?? 1}`],
    ['Brightness', `${g.brightness ?? 100}%`],
    ['Contrast', `${g.contrast ?? 100}%`],
    ['Saturation', `${g.saturation ?? 100}%`],
    ['Hue Shift', `${g.hue ?? 0}°`],
    ['Opacity', `${g.opacity ?? 100}%`],
  ];
  if (g.multiplyEnabled && g.multiplyColor) metrics.push(['Color Multiply', g.multiplyColor]);
  if (g.addEnabled && g.addColor) metrics.push(['Color Add', g.addColor]);

  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
        <Wand2 className="h-3 w-3 text-primary" /> Crafted in StreamForge
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {metrics.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between text-[11px]">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono text-foreground tabular-nums">{value}</span>
          </div>
        ))}
      </div>
      <Button size="sm" variant="secondary" onClick={onAdjust} className="w-full h-7 gap-1.5 text-[11px]">
        <Wand2 className="h-3 w-3" /> Adjust from this recipe
      </Button>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Loads these values back into the filter + correction controls (and cues
        the LUT off so nothing applies twice) — tweak from the same baseline,
        then re-export.
      </p>
    </div>
  );
}

export function VideoFilterPanel() {
  const {
    activeFilter, setActiveFilter, colorGrade, updateColorGrade, resetColorGrade,
    lut, luts, cuedLutId, loadLutFile, cueLut, removeLut,
  } = useStudio();
  const lutInputRef = useRef<HTMLInputElement>(null);
  const [lutError, setLutError] = useState<string | null>(null);
  const [lutLoading, setLutLoading] = useState(false);

  // Custom looks: saved filter + correction bundles (max 5), cueable
  const [looks, setLooks] = useState<SavedLook[]>(loadLooks);
  const [lookName, setLookName] = useState('');
  useEffect(() => {
    localStorage.setItem('studio-looks', JSON.stringify(looks));
  }, [looks]);

  const saveCurrentLook = () => {
    if (looks.length >= MAX_LOOKS) return;
    const name = lookName.trim() || `Look ${looks.length + 1}`;
    setLooks(prev => [...prev, {
      id: crypto.randomUUID(),
      name,
      filter: activeFilter,
      grade: { ...colorGrade },
    }]);
    setLookName('');
  };

  const cueLook = (look: SavedLook) => {
    if (sameLook(activeFilter, colorGrade, look)) {
      // Cue off → back to neutral
      setActiveFilter('none');
      updateColorGrade(NEUTRAL_GRADE);
    } else {
      setActiveFilter(look.filter);
      updateColorGrade(look.grade);
    }
  };

  // A recipe becomes the editing baseline: same look, but adjustable — the
  // LUT cues off so the corrections don't stack on top of the baked table
  const adjustFromRecipe = (recipe: LutRecipe) => {
    cueLut(null);
    const known = filters.some(f => f.id === recipe.filter);
    setActiveFilter(known ? (recipe.filter as VideoFilter) : 'none');
    updateColorGrade({ ...NEUTRAL_GRADE, ...recipe.grade });
  };

  const handleLutFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLutLoading(true);
    setLutError(null);
    const error = await loadLutFile(file);
    setLutError(error);
    setLutLoading(false);
    if (lutInputRef.current) lutInputRef.current.value = '';
  };

  const isNeutral = JSON.stringify(colorGrade) === JSON.stringify(NEUTRAL_GRADE);
  const neutralOf = (key: SliderKey) => NEUTRAL_GRADE[key] as number;
  const setGrade = (key: keyof ColorGrade, value: ColorGrade[keyof ColorGrade]) =>
    updateColorGrade({ [key]: value });

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Apply a filter to your video output. The filter is visible to viewers.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => setActiveFilter(f.id)}
            className={`relative rounded-lg overflow-hidden border-2 transition-all duration-150 ${
              activeFilter === f.id
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-border hover:border-muted-foreground/30'
            }`}
          >
            <div
              className="aspect-video bg-gradient-to-br from-primary/30 via-accent/20 to-secondary"
              style={{ filter: f.css || undefined }}
            />
            <div className="absolute inset-0 flex items-end">
              <span
                className={`w-full text-center py-1.5 text-[11px] font-semibold backdrop-blur-sm ${
                  activeFilter === f.id
                    ? 'bg-primary/80 text-primary-foreground'
                    : 'bg-card/70 text-foreground'
                }`}
              >
                {f.name}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Color Correction */}
      <div className="border-t border-border pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Color Correction
          </h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={resetColorGrade}
            disabled={isNeutral}
            className="h-6 gap-1 px-2 text-[11px]"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
        </div>

        {SLIDERS.map(def => (
          <GradeSlider
            key={def.key}
            def={def}
            value={colorGrade[def.key]}
            neutral={neutralOf(def.key)}
            onChange={v => setGrade(def.key, v)}
          />
        ))}

        <div className="space-y-2 pt-1">
          <ColorBlendRow
            label="Color Multiply"
            enabled={colorGrade.multiplyEnabled}
            color={colorGrade.multiplyColor}
            onToggle={v => setGrade('multiplyEnabled', v)}
            onColor={c => setGrade('multiplyColor', c)}
          />
          <ColorBlendRow
            label="Color Add"
            enabled={colorGrade.addEnabled}
            color={colorGrade.addColor}
            onToggle={v => setGrade('addEnabled', v)}
            onColor={c => setGrade('addColor', c)}
          />
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Applied on top of the selected filter and visible to viewers. Click a
          value to reset that control.
        </p>

        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!downloadCubeLut(activeFilter, colorGrade, 'StreamForge Look')) {
              setLutError('LUT export failed — the rendered color table came back empty');
            }
          }}
          className="w-full gap-2 text-xs"
        >
          <Download className="h-3.5 w-3.5" /> Export Current as LUT (.cube)
        </Button>
        <p className="text-[11px] text-muted-foreground/60 leading-relaxed -mt-1">
          Bakes the filter + corrections above into a standard 33³ .cube file
          usable in Resolve, Premiere, OBS, or back here. Opacity isn't included
          (it's transparency, not color).
        </p>
      </div>

      {/* Custom Looks */}
      <div className="border-t border-border pt-4 space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Custom Looks ({looks.length}/{MAX_LOOKS})
        </h3>

        {looks.map(look => {
          const onAir = sameLook(activeFilter, colorGrade, look);
          return (
            <div
              key={look.id}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                onAir ? 'border-primary/60 bg-primary/5' : 'border-border bg-secondary/30'
              }`}
            >
              <span className="text-xs font-medium text-foreground truncate flex-1">
                {look.name}
                {onAir && <span className="ml-2 text-[10px] font-bold text-primary tracking-wider">● ON</span>}
              </span>
              <Button
                size="sm"
                variant={onAir ? 'destructive' : 'secondary'}
                className="h-6 px-2 text-[11px] gap-1 shrink-0"
                onClick={() => cueLook(look)}
                title={onAir ? 'Cue off (back to neutral)' : 'Apply this look'}
              >
                {onAir ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {onAir ? 'Off' : 'Cue'}
              </Button>
              <button
                onClick={() => downloadCubeLut(look.filter, look.grade, look.name)}
                className="p-1 rounded text-muted-foreground hover:text-primary transition-colors shrink-0"
                title="Download as .cube LUT"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setLooks(prev => prev.filter(l => l.id !== look.id))}
                className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                title="Delete look"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}

        <div className="flex gap-2">
          <Input
            placeholder={`Look name (e.g. "Cinematic")`}
            value={lookName}
            onChange={e => setLookName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveCurrentLook()}
            disabled={looks.length >= MAX_LOOKS}
            className="text-xs h-8"
          />
          <Button
            size="sm"
            onClick={saveCurrentLook}
            disabled={looks.length >= MAX_LOOKS}
            className="h-8 px-3 gap-1.5 text-xs shrink-0"
            title={looks.length >= MAX_LOOKS ? 'Maximum 5 looks' : 'Save the current filter + corrections'}
          >
            <Plus className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Saves the current filter + color corrections. Cue applies a look
          instantly (even mid-stream); cueing off returns to neutral. Looks
          persist across sessions.
        </p>
      </div>

      {/* Color LUT library */}
      <div className="border-t border-border pt-4 space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Color LUTs{luts.length > 0 && ` (${luts.length})`}
        </h3>

        <input
          ref={lutInputRef}
          type="file"
          accept=".cube"
          onChange={handleLutFile}
          className="hidden"
        />

        {luts.length > 0 && (
          // ~5 rows tall; the rest scrolls
          <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
            {luts.map(entry => {
              const cued = entry.id === cuedLutId;
              return (
                <div
                  key={entry.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                    cued ? 'border-primary/60 bg-primary/5' : 'border-border bg-secondary/40'
                  }`}
                >
                  <span className="text-xs font-medium text-foreground truncate flex-1">
                    {entry.lut.name}
                    <span className="text-muted-foreground font-normal ml-1.5">{entry.lut.size}³</span>
                    {entry.lut.recipe && (
                      <span
                        title="Crafted in StreamForge — recipe embedded"
                        className="inline-flex ml-1.5 align-middle text-primary/70"
                      >
                        <Wand2 className="h-3 w-3" />
                      </span>
                    )}
                    {cued && <span className="ml-2 text-[10px] font-bold text-primary tracking-wider">● ON</span>}
                  </span>
                  <Button
                    size="sm"
                    variant={cued ? 'destructive' : 'secondary'}
                    className="h-6 px-2 text-[11px] gap-1 shrink-0"
                    onClick={() => cueLut(cued ? null : entry.id)}
                    title={cued ? 'Cue off — keep loaded, stop applying' : 'Cue on (replaces the cued LUT)'}
                  >
                    {cued ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {cued ? 'Off' : 'Cue'}
                  </Button>
                  <button
                    onClick={() => removeLut(entry.id)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title="Delete saved LUT"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {lut && <LutThumbnail lut={lut} />}
        {lut?.recipe && (
          <LutRecipeCard recipe={lut.recipe} onAdjust={() => adjustFromRecipe(lut.recipe!)} />
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={() => lutInputRef.current?.click()}
          disabled={lutLoading}
          className="w-full gap-2 text-xs"
        >
          {lutLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {luts.length > 0 ? 'Add LUT (.cube)' : 'Upload LUT (.cube)'}
        </Button>

        {lutError && (
          <p className="text-[11px] text-destructive">{lutError}</p>
        )}

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          3D .cube LUTs grade the main video on the preview and broadcast
          (GPU-accelerated), applied before the filter and corrections above.
          One LUT applies at a time — cueing another switches instantly. Added
          LUTs are saved and restored on reload; delete (🗑) removes one for good.
        </p>
      </div>
    </div>
  );
}
