import type { SlimeProfile } from '../../app/model';

export const COLOR_OPTIONS: Array<{ id: SlimeProfile['colorTheme']; label: string; swatch: string }> = [
  { id: 'aurora', label: 'Aurora Blue', swatch: 'bg-gradient-to-br from-sky-400 via-cyan-300 to-indigo-500' },
  { id: 'violet', label: 'Violet Glass', swatch: 'bg-gradient-to-br from-violet-400 via-indigo-400 to-sky-400' },
  { id: 'mint', label: 'Mint Glow', swatch: 'bg-gradient-to-br from-emerald-400 via-teal-300 to-cyan-300' },
  { id: 'sunset', label: 'Sunset Peach', swatch: 'bg-gradient-to-br from-rose-400 via-orange-400 to-amber-300' },
  { id: 'lime', label: 'Cyber Lime', swatch: 'bg-gradient-to-br from-lime-400 via-lime-300 to-cyan-400' },
  { id: 'silver', label: 'Mono Silver', swatch: 'bg-gradient-to-br from-slate-200 via-slate-300 to-slate-500' },
  { id: 'custom', label: 'Custom', swatch: 'bg-gradient-to-br from-fuchsia-500 via-violet-500 to-indigo-600' },
];

export const fieldSelectClass =
  'w-full rounded-xl border border-violet-200/55 bg-white/90 px-3 py-2.5 text-sm text-gray-800 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/25';

export const PERSONALITY_OPTIONS: Array<{ id: SlimeProfile['personality']; label: string }> = [
  { id: 'calm', label: 'Calm' },
  { id: 'direct', label: 'Direct' },
  { id: 'encouraging', label: 'Encouraging' },
  { id: 'analytical', label: 'Analytical' },
  { id: 'playful', label: 'Playful' },
  { id: 'cautious', label: 'Cautious' },
];

export const SHAPE_OPTIONS: Array<{ id: SlimeProfile['shape']; label: string }> = [
  { id: 'classic', label: 'Classic Slime' },
  { id: 'orb', label: 'Soft Orb' },
  { id: 'robot', label: 'Tiny Robot Blob' },
  { id: 'crystal', label: 'Crystal Blob' },
  { id: 'ghost', label: 'Ghost Blob' },
];

export const ACCESSORY_OPTIONS: Array<{ id: SlimeProfile['accessory']; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'glasses', label: 'Tiny glasses' },
  { id: 'halo', label: 'Small halo ring' },
  { id: 'antenna', label: 'Little antenna' },
  { id: 'scarf', label: 'Scarf / ribbon' },
  { id: 'spark', label: 'Spark particles' },
];

export const MOTION_OPTIONS: Array<{ id: SlimeProfile['motion']; label: string }> = [
  { id: 'subtle', label: 'Subtle' },
  { id: 'normal', label: 'Normal' },
  { id: 'expressive', label: 'Expressive' },
];

export const SLIME_PRESETS: Array<{
  id: string;
  label: string;
  patch: Pick<SlimeProfile, 'colorTheme' | 'personality' | 'shape' | 'accessory' | 'motion'>;
}> = [
  {
    id: 'calm_violet',
    label: 'Calm Violet',
    patch: { colorTheme: 'violet', personality: 'calm', shape: 'classic', accessory: 'none', motion: 'subtle' },
  },
  {
    id: 'mint_robot',
    label: 'Mint Bot',
    patch: { colorTheme: 'mint', personality: 'analytical', shape: 'robot', accessory: 'antenna', motion: 'normal' },
  },
  {
    id: 'sunset_hype',
    label: 'Sunset Spark',
    patch: { colorTheme: 'sunset', personality: 'encouraging', shape: 'orb', accessory: 'halo', motion: 'expressive' },
  },
];
