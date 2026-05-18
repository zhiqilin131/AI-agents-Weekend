/** Sort buddy/sidebar threads newest-first by activity, then creation time. */
export function sortThreadsByRecent<
  T extends { updated_at?: string; created_at?: string },
>(threads: T[]): T[] {
  const ts = (raw?: string) => {
    const n = Date.parse(raw);
    return Number.isNaN(n) ? 0 : n;
  };
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => {
      const updatedDelta = ts(b.thread.updated_at) - ts(a.thread.updated_at);
      if (updatedDelta !== 0) return updatedDelta;
      const createdDelta = ts(b.thread.created_at) - ts(a.thread.created_at);
      if (createdDelta !== 0) return createdDelta;
      return a.index - b.index;
    })
    .map(({ thread }) => thread);
}
