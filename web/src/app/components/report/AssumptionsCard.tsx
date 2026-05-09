import { useCallback, useState } from 'react';
import { Check, ClipboardList, Copy } from 'lucide-react';
import { cn } from '../ui/utils';

type Flag = 'none' | 'not_true' | 'adjust';

function buildChatSnippet(assumption: string, note: string): string {
  const n = note.trim();
  return [
    'I want to revisit an assumption from my decision report:',
    `• ${assumption}`,
    '',
    n ? `Here is my update / new context:\n${n}` : 'Here is my update / new context:\n_(add details above, then copy again)_',
  ].join('\n');
}

export function AssumptionsCard({ assumptions }: { assumptions: string[] }) {
  const [flags, setFlags] = useState<Record<number, Flag>>({});
  const [adjustNotes, setAdjustNotes] = useState<Record<number, string>>({});
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyForChat = useCallback(async (i: number, assumption: string) => {
    const text = buildChatSnippet(assumption, adjustNotes[i] ?? '');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(i);
      window.setTimeout(() => setCopiedIndex((c) => (c === i ? null : c)), 2000);
    } catch {
      setCopiedIndex(null);
    }
  }, [adjustNotes]);

  if (!assumptions.length) {
    return (
      <section className="rounded-2xl border border-dashed border-gray-200 bg-white/50 p-5 text-sm text-gray-600">
        No explicit assumptions were listed for the recommended option.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-white/90 bg-white/78 backdrop-blur-md p-5 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-100 bg-amber-50">
          <ClipboardList className="h-5 w-5 text-amber-800" aria-hidden />
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900">Assumptions</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            Mark what is shaky, then use <span className="font-semibold text-gray-800">Adjust</span> to capture how
            you would change it — copy a ready-made message into Shadow chat or “Revise report”.
          </p>
        </div>
      </div>
      <ul className="space-y-3">
        {assumptions.map((text, i) => {
          const flag = flags[i] ?? 'none';
          return (
            <li
              key={`asm-${i}`}
              className={cn(
                'rounded-xl border px-3 py-3 text-sm text-gray-800 leading-relaxed transition-colors',
                flag === 'not_true' && 'border-rose-200 bg-rose-50/50',
                flag === 'adjust' && 'border-indigo-200 bg-indigo-50/40',
                flag === 'none' && 'border-gray-100 bg-gray-50/50',
              )}
            >
              <p className="font-medium">{text}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    flag === 'not_true'
                      ? 'border-rose-400 bg-rose-100 text-rose-950'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                  )}
                  onClick={() =>
                    setFlags((prev) => {
                      const next = prev[i] === 'not_true' ? 'none' : 'not_true';
                      return { ...prev, [i]: next };
                    })
                  }
                >
                  Not true
                </button>
                <button
                  type="button"
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    flag === 'adjust'
                      ? 'border-indigo-500 bg-indigo-600 text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                  )}
                  onClick={() =>
                    setFlags((prev) => {
                      const next = prev[i] === 'adjust' ? 'none' : 'adjust';
                      return { ...prev, [i]: next };
                    })
                  }
                >
                  Adjust
                </button>
              </div>

              {flag === 'not_true' ? (
                <p className="mt-3 rounded-lg border border-rose-100 bg-white/80 px-2.5 py-2 text-xs text-rose-900">
                  Treat this premise as weaker until you update context or regenerate the report.
                </p>
              ) : null}

              {flag === 'adjust' ? (
                <div className="mt-3 space-y-2 rounded-lg border border-indigo-100 bg-white/90 px-3 py-3">
                  <label className="block text-[11px] font-semibold text-indigo-900" htmlFor={`assumption-note-${i}`}>
                    How would you change this assumption?
                  </label>
                  <textarea
                    id={`assumption-note-${i}`}
                    rows={3}
                    value={adjustNotes[i] ?? ''}
                    onChange={(e) => setAdjustNotes((prev) => ({ ...prev, [i]: e.target.value }))}
                    placeholder="e.g. timeline moved, budget cut, new stakeholder…"
                    className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyForChat(i, text)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
                    >
                      {copiedIndex === i ? (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {copiedIndex === i ? 'Copied' : 'Copy for chat'}
                    </button>
                    <span className="text-[10px] text-gray-500">Paste into Shadow chat or use Revise report.</span>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
