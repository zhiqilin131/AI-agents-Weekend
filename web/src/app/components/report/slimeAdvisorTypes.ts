import type { SlimeProfile } from '../../model';
import type { SlimeType } from '../../../features/slime/slimeIdentity';
import type { StudioAura } from '../../../features/slime/visual3d/variants/StudioDeskScene';

export type SlimeAdvisorState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'remembering'
  | 'preparing'
  | 'speaking'
  | 'cautious'
  | 'celebrating';

export type SlimeAdvisorProps = {
  state?: SlimeAdvisorState;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  profile?: SlimeProfile;
  slimeType?: SlimeType;
  /** Stronger hover / float — for buddy home, not dense report rows. */
  companionMode?: boolean;
  /** Slime Buddy page — larger hero scale (+30% vs default companion). */
  buddyPage?: boolean;
  /** Embedded in chat studio — centered, softer colors, less horizontal drift. */
  studioScene?: boolean;
  /** Optional TTS amplitude 0–1 for mouth/body pulse. */
  speakAmplitude?: number;
  /** Increments trigger idle goo splatter + body jiggle (Buddy). */
  gooBurstKey?: number;
  /** Force SVG fallback (SSR/tests or no WebGL). */
  force2D?: boolean;
  /** Chat studio mood aura (3D desk scene). */
  studioAura?: StudioAura;
  studioAccent?: string;
  /** Report mouth screen position for comic bubble tail (relative to bubble + bias in stage). */
  onMouthAnchor?: (anchor: { clientX: number; clientY: number }) => void;
};

export const SLIME_SIZE_MAP = { sm: 56, md: 76, lg: 104 } as const;
