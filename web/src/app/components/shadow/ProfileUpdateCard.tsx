export function ProfileUpdateCard({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Profile memory updated</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {items.slice(0, 4).map((x, i) => (
          <li key={`${x}-${i}`} className="text-sm text-emerald-900">
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

