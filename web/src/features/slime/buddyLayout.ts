/**
 * Top offset for buddy side rails.
 * Keep a clearly visible gap under the fixed top bar so rail buttons never visually touch it.
 */
export const BUDDY_TOPBAR_CLEARANCE =
  'max(13rem,calc(env(safe-area-inset-top,0px) + 12.5rem))';

/** Horizontal padding inside left-rail cards (companion switch + recent panels). */
export const BUDDY_RAIL_CONTENT_X = 'px-1';

/** Fallback until top-nav brand position is measured (see data-buddy-rail-align). */
export const BUDDY_RAIL_LEFT_FALLBACK =
  'max(0.75rem, env(safe-area-inset-left, 0px))';

export const BUDDY_LEFT_RAIL_MAX_HEIGHT = `calc(100dvh - ${BUDDY_TOPBAR_CLEARANCE} - env(safe-area-inset-bottom,0px))`;

export const BUDDY_RIGHT_RAIL_MAX_HEIGHT = BUDDY_LEFT_RAIL_MAX_HEIGHT;

/**
 * Buddy voice dock is viewport-fixed near the very bottom so it sits well below the slime.
 * Dropdowns open upward so all models are visible without scrolling.
 */
export const BUDDY_VOICE_DOCK_BOTTOM =
  'max(2.5rem,calc(env(safe-area-inset-bottom,0px) + 1.5rem))';

/** Hints / errors above the buddy voice dock. */
export const BUDDY_VOICE_HINTS_BOTTOM =
  'max(9rem,calc(env(safe-area-inset-bottom,0px) + 12rem))';
