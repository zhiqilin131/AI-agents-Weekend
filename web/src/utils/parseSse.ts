export function parseSseBlocks(
  buffer: string,
  onEvent: (data: Record<string, unknown>) => void,
): string {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    const line = block.trim();
    if (!line.startsWith('data: ')) continue;
    try {
      onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
    } catch {
      /* skip bad chunk */
    }
  }
  return rest;
}
