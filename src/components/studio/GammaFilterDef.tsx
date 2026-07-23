import { useStudio } from '@/contexts/StudioContext';
import { GAMMA_FILTER_ID } from '@/lib/streamCompositor';

/**
 * Hidden SVG filter implementing gamma correction (CSS/canvas filters have no
 * gamma function). Both the preview's CSS `filter: url(#…)` and the broadcast
 * compositor's `ctx.filter` reference this single definition, so preview and
 * stream apply identical gamma.
 *
 * feFuncX gamma: out = amplitude * in^exponent + offset. A user gamma g > 1
 * should brighten midtones, so exponent = 1/g.
 */
export function GammaFilterDef() {
  const { colorGrade } = useStudio();
  const exponent = 1 / Math.max(0.1, colorGrade.gamma);

  return (
    <svg width="0" height="0" className="absolute pointer-events-none" aria-hidden="true">
      <defs>
        <filter id={GAMMA_FILTER_ID} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="gamma" amplitude="1" exponent={exponent} offset="0" />
            <feFuncG type="gamma" amplitude="1" exponent={exponent} offset="0" />
            <feFuncB type="gamma" amplitude="1" exponent={exponent} offset="0" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}
