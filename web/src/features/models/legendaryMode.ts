import { useEffect, useState } from 'react';

/** Product id for the hidden “5.5” tier (must match server catalog ``slime_55``). */
export const SLIME_LEGENDARY_MODEL_ID = 'slime_55';

const STORAGE_KEY = 'slimeLegendaryMode';

export function readSlimeLegendaryMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist legendary UI + dispatch so ``useSlimeModelCatalog`` refilters the catalog. */
export function setSlimeLegendaryMode(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new Event('slime-legendary-mode'));
}

export function useSlimeLegendaryMode(): boolean {
  const [on, setOn] = useState(readSlimeLegendaryMode);
  useEffect(() => {
    const sync = () => setOn(readSlimeLegendaryMode());
    window.addEventListener('slime-legendary-mode', sync);
    return () => window.removeEventListener('slime-legendary-mode', sync);
  }, []);
  return on;
}
