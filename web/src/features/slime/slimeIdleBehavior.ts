/** Buddy idle fidget — no interaction for this long before shake + goo splatter. */
export const SLIME_IDLE_INTERACT_MS = 10_000;

/** Random interval between idle fidgets (ms). */
export function slimeIdleFidgetIntervalMs(): number {
  return 11_000 + Math.random() * 5_000;
}
