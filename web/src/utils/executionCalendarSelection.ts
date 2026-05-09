import { EXECUTION_SELECTED_BLOCKS_CONTEXT_KEY } from './executionStorageKeys';

export type SelectedBlocksContext = {
  taskIds: string[];
  titles: string[];
  savedAt: number;
};

/** Derive execution task id from a calendar block id (`ai-{taskId}`). */
export function taskIdFromAiCalendarEventId(eventId: string): string | null {
  if (!eventId.startsWith('ai-')) return null;
  const rest = eventId.slice(3);
  return rest.length ? rest : null;
}

export function saveSelectedBlocksContext(taskIds: string[], titles: string[]): void {
  try {
    sessionStorage.setItem(
      EXECUTION_SELECTED_BLOCKS_CONTEXT_KEY,
      JSON.stringify({ taskIds, titles, savedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export function loadSelectedBlocksContext(): SelectedBlocksContext | null {
  try {
    const raw = sessionStorage.getItem(EXECUTION_SELECTED_BLOCKS_CONTEXT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { taskIds?: unknown; titles?: unknown; savedAt?: unknown };
    if (!Array.isArray(o.taskIds) || !o.taskIds.every((x) => typeof x === 'string')) return null;
    const titles = Array.isArray(o.titles) && o.titles.every((x) => typeof x === 'string') ? o.titles : [];
    return { taskIds: o.taskIds, titles, savedAt: Number(o.savedAt) || 0 };
  } catch {
    return null;
  }
}

export function clearSelectedBlocksContext(): void {
  try {
    sessionStorage.removeItem(EXECUTION_SELECTED_BLOCKS_CONTEXT_KEY);
  } catch {
    // ignore
  }
}
