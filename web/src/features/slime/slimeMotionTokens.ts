/**
 * Shared Slime motion timings — keep CSS custom properties in tailwind.css aligned with these names.
 */

/** Buddy speech-bubble tail anchor (fixed at mouth; do not tie to bubble height). */
export const SLIME_BUBBLE_MOUTH_Y = '10.9rem';

/** Nudge tail chain slightly right of projected mouth center. */
export const SLIME_BUBBLE_MOUTH_X_BIAS_PX = 12;

export const SLIME_BUBBLE_CSS_VARS = {
  mouthX: '--slime-bubble-mouth-x',
  mouthY: '--slime-bubble-mouth-y',
  tailSpeakDur: '--slime-bubble-tail-speak-dur',
  tailIdleDur: '--slime-bubble-tail-idle-dur',
  bodyBreatheDur: '--slime-bubble-body-breathe-dur',
  bodyBreatheLift: '--slime-bubble-body-breathe-lift',
  bodyBreatheScale: '--slime-bubble-body-breathe-scale',
} as const;

/** Irregular speak cycle — short closes + brief pauses (not lip-sync). */
export const SLIME_MOUTH_SPEAK_WELLBEING = {
  duration: 1.18,
  times: [0, 0.09, 0.17, 0.28, 0.36, 0.5, 0.62, 0.74, 0.86, 1] as number[],
  ry: [1.4, 3.2, 1.6, 1.1, 3.8, 2.2, 1.25, 4.1, 2.4, 1.5],
  rx: [6.2, 6.5, 6.25, 6.35, 6.7, 6.3, 6.4, 6.75, 6.35, 6.2],
};

export const SLIME_MOUTH_SPEAK_GENERALIZED = {
  duration: 0.62,
  times: [0, 0.11, 0.2, 0.3, 0.38, 0.52, 0.64, 0.78, 0.9, 1] as number[],
  ry: [1.8, 4.6, 2.4, 1.05, 4.9, 2.8, 1.35, 5.1, 2.6, 1.9],
  rx: [6.3, 6.85, 6.35, 6.45, 6.95, 6.4, 6.5, 7, 6.45, 6.3],
};

export const SLIME_DRAG_RELEASE_SPRING = { stiffness: 360, damping: 20, mass: 0.85 };
export const SLIME_HOVER_SQUISH = { scale: 1.035, transition: { type: 'spring' as const, stiffness: 520, damping: 24 } };
