const STORAGE_KEY = 'therapySessionDockExpanded';

/** Session control rail: expanded by default; user preference persisted. */
export function readTherapySessionDockExpanded(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

export function writeTherapySessionDockExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0');
  } catch {
    /* ignore */
  }
}
