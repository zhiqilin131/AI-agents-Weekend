/**
 * Merge SSE `partial` payloads into an accumulated trace-shaped object for `mapTraceToReport`.
 */
export function mergeStreamingPartial(
  prev: Record<string, unknown> | null,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = prev ? { ...prev } : {};
  for (const [k, v] of Object.entries(data)) {
    base[k] = v;
  }
  return base;
}
