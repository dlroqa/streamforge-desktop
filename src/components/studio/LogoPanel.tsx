import { useStudio } from '@/contexts/StudioContext';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Upload, X, Eye, EyeOff, ImageIcon } from 'lucide-react';
import { useRef, useState } from 'react';

// 3×3 quick-position grid (fractions of the canvas)
const POSITIONS = [0.1, 0.5, 0.9];

export function LogoPanel() {
  const { logo, loadLogoFile, updateLogo, clearLogo, isLive } = useStudio();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(await loadLogoFile(file));
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,video/mp4,video/webm"
        onChange={handleFile}
        className="hidden"
      />

      {!logo ? (
        <>
          <div className="text-center py-6">
            <ImageIcon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No logo uploaded</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              PNG or JPG image, or a looping MP4/WebM animation
            </p>
          </div>
          <Button size="sm" onClick={() => inputRef.current?.click()} className="w-full gap-2">
            <Upload className="h-3.5 w-3.5" /> Upload Logo
          </Button>
        </>
      ) : (
        <>
          {/* Preview card */}
          <div className="rounded-lg border border-border bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4 flex items-center justify-center">
            {logo.kind === 'video' ? (
              <video src={logo.url} autoPlay loop muted playsInline className="max-h-24 max-w-full" style={{ opacity: logo.opacity / 100 }} />
            ) : (
              <img src={logo.url} alt="Logo" className="max-h-24 max-w-full" style={{ opacity: logo.opacity / 100 }} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant={logo.visible ? 'destructive' : 'default'}
              onClick={() => updateLogo({ visible: !logo.visible })}
              className="gap-1.5 text-xs"
            >
              {logo.visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {logo.visible ? 'Hide' : 'Show'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} className="gap-1.5 text-xs">
              <Upload className="h-3.5 w-3.5" /> Replace
            </Button>
          </div>

          {/* Quick positions */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Position</label>
            <div className="grid grid-cols-3 gap-1 w-24 mx-auto">
              {POSITIONS.map(py =>
                POSITIONS.map(px => {
                  const active = Math.abs(logo.x - px) < 0.05 && Math.abs(logo.y - py) < 0.05;
                  return (
                    <button
                      key={`${px}-${py}`}
                      onClick={() => updateLogo({ x: px, y: py })}
                      className={`h-7 rounded border transition-colors ${
                        active ? 'bg-primary border-primary' : 'bg-secondary/50 border-border hover:bg-secondary'
                      }`}
                      title={`Move to ${py < 0.3 ? 'top' : py > 0.7 ? 'bottom' : 'middle'} ${px < 0.3 ? 'left' : px > 0.7 ? 'right' : 'center'}`}
                    />
                  );
                }),
              )}
            </div>
            <p className="text-[11px] text-muted-foreground text-center mt-1.5">
              {isLive ? 'Fine-tune with the sliders below' : 'Or drag the logo directly on the preview'}
            </p>
          </div>

          {/* Fine positioning */}
          <div className="space-y-3">
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">Horizontal</span>
                <span className="text-[11px] font-mono text-muted-foreground">{Math.round(logo.x * 100)}%</span>
              </div>
              <Slider value={[logo.x * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateLogo({ x: v / 100 })} />
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">Vertical</span>
                <span className="text-[11px] font-mono text-muted-foreground">{Math.round(logo.y * 100)}%</span>
              </div>
              <Slider value={[logo.y * 100]} min={0} max={100} step={1} onValueChange={([v]) => updateLogo({ y: v / 100 })} />
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">Size</span>
                <span className="text-[11px] font-mono text-muted-foreground">{Math.round(logo.scale * 100)}%</span>
              </div>
              <Slider value={[logo.scale * 100]} min={3} max={60} step={1} onValueChange={([v]) => updateLogo({ scale: v / 100 })} />
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">Opacity</span>
                <span className="text-[11px] font-mono text-muted-foreground">{logo.opacity}%</span>
              </div>
              <Slider value={[logo.opacity]} min={10} max={100} step={1} onValueChange={([v]) => updateLogo({ opacity: v })} />
            </div>
          </div>

          <Button size="sm" variant="outline" onClick={clearLogo} className="w-full gap-2 text-xs text-destructive hover:text-destructive">
            <X className="h-3.5 w-3.5" /> Remove Logo
          </Button>
        </>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Shown on the broadcast above the video, below lower thirds and polls.
        For animated logos use a short looping MP4/WebM (GIFs show their first
        frame only). Session only — re-upload after a reload.
      </p>
    </div>
  );
}
