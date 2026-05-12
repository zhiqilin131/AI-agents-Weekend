import type { CSSProperties } from 'react';
import type { SlimeProfile } from '../../../app/model';
import { DEFAULT_SLIME_PROFILE } from '../../../hooks/useSlimeProfile';
import { slimeThemePalette } from '../../../features/slime/slimeThemePalette';
import { cn } from '../ui/utils';

type Props = {
  onClick: () => void;
  className?: string;
  /** When omitted, uses default violet palette until profile loads. */
  profile?: SlimeProfile;
};

/** Blends theme hues with the landing wash so the CTA sits closer to cards / nav, not a loud jewel. */
function landingBackground(p: SlimeProfile, t: ReturnType<typeof slimeThemePalette>): string {
  const wash = '#faf8ff';
  if (p.colorTheme === 'silver') {
    return `linear-gradient(152deg, color-mix(in srgb, ${t.c} 52%, ${wash}) 0%, color-mix(in srgb, ${t.b} 48%, ${wash}) 48%, color-mix(in srgb, ${t.a} 55%, white) 100%)`;
  }
  return `radial-gradient(118% 96% at 34% 30%, color-mix(in srgb, ${t.b} 40%, ${wash}) 0%, color-mix(in srgb, ${t.a} 36%, ${wash}) 50%, color-mix(in srgb, ${t.c} 32%, ${wash}) 100%)`;
}

function labelTone(_p: SlimeProfile): string {
  return 'text-slate-800';
}

/**
 * Landing hero CTA — palette matches in-app slime (``slimeThemePalette`` + ``SlimeAdvisor``).
 */
export function SlimeLandingCta({ onClick, className, profile }: Props) {
  const p = profile ?? DEFAULT_SLIME_PROFILE;
  const t = slimeThemePalette(p);
  const bg = landingBackground(p, t);

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <button
        type="button"
        onClick={onClick}
        style={
          {
            background: bg,
            '--slime-accent': t.c,
          } as CSSProperties
        }
        className={cn(
          'slime-cta-btn group relative inline-flex min-w-[12.5rem] items-center justify-center overflow-hidden',
          'rounded-[1.85rem] border border-violet-200/45 px-10 py-4 text-lg',
          'origin-center font-semibold tracking-tight backdrop-blur-[2px]',
          'transition-[filter] duration-300 hover:brightness-[1.02] active:scale-[0.98]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f3ff]',
          labelTone(p),
        )}
      >
        <span className="relative z-[1]">Slime Chat</span>
      </button>
    </div>
  );
}
