type Props = {
  diagnostics: Record<string, unknown> | null;
};

/** Dev-only collapsible source counts for empty-diary debugging */
export function DiaryDebugPanel({ diagnostics }: Props) {
  if (!import.meta.env.DEV || !diagnostics) return null;

  return (
    <details className="mx-auto mb-4 max-w-lg rounded-xl border border-amber-200/90 bg-amber-50/80 px-3 py-2 text-left text-[11px] text-amber-950">
      <summary className="cursor-pointer font-semibold">Source diagnostics (dev)</summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed">
        {JSON.stringify(diagnostics, null, 2)}
      </pre>
    </details>
  );
}
