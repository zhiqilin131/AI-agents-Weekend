export function ModePill({ mode }: { mode: string }) {
  const label =
    mode === 'roleplay'
      ? 'Role Mode'
      : mode === 'decision_report'
        ? 'Decision Report Open'
        : 'Normal';
  return <div className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-800">{label}</div>;
}

