/** Clearance below the fixed top nav on Slime Buddy (matches MainNavButtons spacer + bar). */
export const BUDDY_TOPBAR_CLEARANCE =
  'max(6.25rem,calc(env(safe-area-inset-top,0px)+5.5rem))';

export const BUDDY_LEFT_RAIL_MAX_HEIGHT = `calc(100dvh - ${BUDDY_TOPBAR_CLEARANCE} - env(safe-area-inset-bottom,0px))`;

export const BUDDY_RIGHT_RAIL_MAX_HEIGHT = BUDDY_LEFT_RAIL_MAX_HEIGHT;
