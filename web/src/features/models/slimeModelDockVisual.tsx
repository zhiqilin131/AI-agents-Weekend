import type { LucideIcon } from 'lucide-react';
import {
  Brain,
  Coins,
  Layers3,
  Microscope,
  SlidersHorizontal,
  Star,
  Wind,
} from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { slimeModelDockAbbrev } from './slimeModelDockAbbrev';

export type SlimeModelDockVisual = {
  abbrev: string;
  label: string;
  iconId: string;
  Icon: LucideIcon;
  /** Gem background for the tier icon chip. */
  gemBackground: string;
  gemBorder: string;
  iconColor: string;
  iconGlow: string;
};

const SLIME_MODEL_DOCK_VISUAL: Record<string, Omit<SlimeModelDockVisual, 'abbrev' | 'label'>> = {
  little: {
    iconId: 'coins',
    Icon: Coins,
    gemBackground: 'linear-gradient(145deg, #ecfdf5 0%, #d1fae5 55%, #a7f3d0 100%)',
    gemBorder: 'rgba(16, 185, 129, 0.35)',
    iconColor: '#047857',
    iconGlow: 'drop-shadow(0 1px 2px rgba(16, 185, 129, 0.35))',
  },
  swift: {
    iconId: 'wind',
    Icon: Wind,
    gemBackground: 'linear-gradient(145deg, #ecfeff 0%, #cffafe 55%, #a5f3fc 100%)',
    gemBorder: 'rgba(6, 182, 212, 0.38)',
    iconColor: '#0e7490',
    iconGlow: 'drop-shadow(0 1px 2px rgba(6, 182, 212, 0.35))',
  },
  balanced: {
    iconId: 'sliders',
    Icon: SlidersHorizontal,
    gemBackground: 'linear-gradient(145deg, #eff6ff 0%, #dbeafe 55%, #bfdbfe 100%)',
    gemBorder: 'rgba(59, 130, 246, 0.38)',
    iconColor: '#1d4ed8',
    iconGlow: 'drop-shadow(0 1px 2px rgba(59, 130, 246, 0.32))',
  },
  deep: {
    iconId: 'brain',
    Icon: Brain,
    gemBackground: 'linear-gradient(145deg, #f5f3ff 0%, #ede9fe 55%, #ddd6fe 100%)',
    gemBorder: 'rgba(124, 58, 237, 0.35)',
    iconColor: '#6d28d9',
    iconGlow: 'drop-shadow(0 1px 2px rgba(124, 58, 237, 0.32))',
  },
  slime_55: {
    iconId: 'star',
    Icon: Star,
    gemBackground: 'linear-gradient(145deg, #fffbeb 0%, #fde68a 45%, #fbbf24 100%)',
    gemBorder: 'rgba(217, 119, 6, 0.42)',
    iconColor: '#b45309',
    iconGlow: 'drop-shadow(0 1px 3px rgba(245, 158, 11, 0.45))',
  },
  research: {
    iconId: 'microscope',
    Icon: Microscope,
    gemBackground: 'linear-gradient(145deg, #eef2ff 0%, #e0e7ff 55%, #c7d2fe 100%)',
    gemBorder: 'rgba(79, 70, 229, 0.35)',
    iconColor: '#4338ca',
    iconGlow: 'drop-shadow(0 1px 2px rgba(79, 70, 229, 0.32))',
  },
};

const DEFAULT_VISUAL: Omit<SlimeModelDockVisual, 'abbrev' | 'label'> = {
  iconId: 'layers',
  Icon: Layers3,
  gemBackground: 'linear-gradient(145deg, #f8fafc 0%, #e2e8f0 55%, #cbd5e1 100%)',
  gemBorder: 'rgba(100, 116, 139, 0.35)',
  iconColor: '#475569',
  iconGlow: 'drop-shadow(0 1px 2px rgba(71, 85, 105, 0.25))',
};

export function getSlimeModelDockVisual(modelId: string, displayName?: string): SlimeModelDockVisual {
  const id = modelId.trim().toLowerCase();
  const base = SLIME_MODEL_DOCK_VISUAL[id] ?? DEFAULT_VISUAL;
  return {
    abbrev: slimeModelDockAbbrev(modelId, displayName),
    label: displayName?.trim() || modelId,
    ...base,
  };
}

type SlimeModelDockTierGlyphProps = {
  modelId: string;
  displayName?: string;
  /** Trigger on the buddy dock bar. */
  size?: 'dock' | 'menu';
  className?: string;
};

/** Tier-specific gem icon + abbrev badge for model/speed selection. */
export function SlimeModelDockTierGlyph({
  modelId,
  displayName,
  size = 'dock',
  className,
}: SlimeModelDockTierGlyphProps) {
  const visual = getSlimeModelDockVisual(modelId, displayName);
  const { Icon, abbrev, gemBackground, gemBorder, iconColor, iconGlow } = visual;
  const isDock = size === 'dock';

  return (
    <span
      className={cn(
        'pointer-events-none inline-flex items-center leading-none',
        isDock ? 'gap-1' : 'gap-1.5',
        className,
      )}
      aria-hidden
    >
      <span
        className={cn(
          'relative inline-flex shrink-0 items-center justify-center rounded-[9px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]',
          isDock ? 'h-[1.35rem] w-[1.35rem]' : 'h-5 w-5',
        )}
        style={{
          background: gemBackground,
          borderColor: gemBorder,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 4px ${gemBorder}`,
        }}
      >
        <Icon
          className={cn(isDock ? 'h-[0.7rem] w-[0.7rem]' : 'h-3 w-3')}
          style={{ color: iconColor, filter: iconGlow }}
          strokeWidth={2.35}
          aria-hidden
        />
      </span>
      <span
        className={cn(
          'font-extrabold tabular-nums tracking-[0.1em] text-slate-800',
          isDock ? 'text-[8px]' : 'text-[9px]',
        )}
      >
        {abbrev}
      </span>
    </span>
  );
}
