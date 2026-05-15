import type { ShadowMessage } from '../../app/components/shadow/types';

function ellipsize(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function recapLines(messages: ShadowMessage[], limit = 4): Array<{ role: 'user' | 'assistant'; text: string }> {
  const rows: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (let i = messages.length - 1; i >= 0 && rows.length < limit; i -= 1) {
    const m = messages[i];
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = String(m.content || '').trim();
    if (!text) continue;
    rows.unshift({ role: m.role, text: ellipsize(text, 120) });
  }
  return rows;
}
