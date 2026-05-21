/**
 * WebGL slime toggle (Vite bakes this at build time).
 * - `VITE_SLIME_3D=1` / `true` → on
 * - `VITE_SLIME_3D=0` / `false` → off (CI, low-end previews)
 * - unset in production build → on (so Vercel does not need a separate env var)
 * - unset in local dev → off (use `web/.env.development` with `VITE_SLIME_3D=1`)
 */
export function parseSlime3DFlag(flag: string | undefined, isProd: boolean): boolean {
  const f = flag?.trim();
  if (f === '0' || f === 'false') return false;
  if (f === '1' || f === 'true') return true;
  return isProd;
}

export const SLIME_3D_ENABLED = parseSlime3DFlag(
  import.meta.env.VITE_SLIME_3D,
  import.meta.env.PROD,
);

export type SlimeVisualVariant = 'hero' | 'buddyHero' | 'studio' | 'chip' | 'inline';

/** Buddy / home hero stage body scale. */
export const SLIME_HERO_BODY_SCALE = 0.72;

/** Slime Buddy page body scale (tuned −20% then +10% vs original buddy hero). */
export const SLIME_BUDDY_HERO_BODY_SCALE = SLIME_HERO_BODY_SCALE * 1.3 * 0.8 * 1.1;

/** Canvas spread multiplier for `buddyHero`. */
export const SLIME_BUDDY_HERO_SPREAD_MUL = 1.75 * 1.3 * 0.8 * 1.1;

export const SLIME_BODY_SEGMENTS = 128;

export function slimeVariantFromProps(opts: {
  size?: 'sm' | 'md' | 'lg';
  companionMode?: boolean;
  buddyPage?: boolean;
  studioScene?: boolean;
}): SlimeVisualVariant {
  if (opts.studioScene) return 'studio';
  if (opts.companionMode && opts.buddyPage) return 'buddyHero';
  if (opts.companionMode) return 'hero';
  if (opts.size === 'sm') return 'chip';
  if (opts.size === 'lg') return 'inline';
  return 'inline';
}

export function displayScaleForVariant(variant: SlimeVisualVariant): number {
  if (variant === 'buddyHero') return SLIME_BUDDY_HERO_BODY_SCALE;
  if (variant === 'hero') return SLIME_HERO_BODY_SCALE;
  return 1;
}

export function dprForVariant(variant: SlimeVisualVariant): [number, number] {
  if (variant === 'hero' || variant === 'buddyHero' || variant === 'studio') return [1.5, 2.5];
  if (variant === 'chip') return [1.25, 1.75];
  return [1.25, 2];
}

/** Layout box and canvas pixel size must match to avoid side clipping. */
export function slimeCanvasLayout(size: 'sm' | 'md' | 'lg', variant: SlimeVisualVariant): {
  spread: number;
  px: number;
} {
  const base = { sm: 56, md: 76, lg: 104 }[size];
  const spreadMul =
    variant === 'studio'
      ? 2.05
      : variant === 'buddyHero'
        ? SLIME_BUDDY_HERO_SPREAD_MUL
        : variant === 'hero'
          ? 1.75
          : 2.15;
  const spread = Math.round(base * spreadMul);
  return { spread, px: spread };
}

export function cameraForVariant(variant: SlimeVisualVariant): {
  position: [number, number, number];
  fov: number;
} {
  if (variant === 'hero' || variant === 'buddyHero') {
    return { position: [0, 0.1, 2.75], fov: 31 };
  }
  if (variant === 'chip') return { position: [0, 0.1, 2.35], fov: 34 };
  return { position: [0, 0.12, 2.25], fov: 36 };
}

export function slimeSceneYOffset(variant: SlimeVisualVariant): number {
  if (variant === 'hero' || variant === 'buddyHero') return 0.06;
  if (variant === 'chip') return 0.1;
  return 0.06;
}

/** @deprecated Use slimeCanvasLayout */
export function canvasPixelSize(size: 'sm' | 'md' | 'lg', variant: SlimeVisualVariant): number {
  return slimeCanvasLayout(size, variant).px;
}
