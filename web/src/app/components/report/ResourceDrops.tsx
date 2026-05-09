"use client";

import { useState } from 'react';
import type { ResourceDrop } from '../../model';
import { RESOURCE_DROP_CALENDAR_ID } from '../../model';
import { ResourceDropChip } from './ResourceDropChip';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../ui/utils';

const MAX_VISIBLE = 2;

export function ResourceDrops({
  drops,
  loading,
  onInternalCalendar,
  className,
}: {
  drops: ResourceDrop[];
  loading: boolean;
  onInternalCalendar: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!loading && drops.length === 0) return null;

  const visible = drops.slice(0, MAX_VISIBLE);
  const extra = drops.length - visible.length;

  return (
    <div className={cn('mt-2 space-y-2', className)} data-testid="resource-drops">
      {loading ? (
        <p className="text-[11px] font-medium text-violet-700/90">Finding useful resources…</p>
      ) : null}
      {!loading && drops.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {visible.map((d, i) => (
            <ResourceDropChip
              key={d.id}
              drop={d}
              style={{
                animation: `resourceDropIn 0.38s ease-out ${i * 70}ms both`,
              }}
              onInternalCalendar={
                d.id === RESOURCE_DROP_CALENDAR_ID || d.action_type === 'calendar' ? onInternalCalendar : undefined
              }
            />
          ))}
          {extra > 0 ? (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="resource-drops-more"
                  className="rounded-full border border-dashed border-violet-300/90 bg-violet-50/60 px-2.5 py-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-100/80"
                >
                  +{extra} more
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-80 w-80 overflow-y-auto p-3 text-sm">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">All resources</p>
                <ul className="space-y-3">
                  {drops.map((d) => (
                    <li key={d.id} className="rounded-lg border border-gray-100 bg-gray-50/80 px-2 py-2">
                      <p className="font-semibold text-gray-900">{d.title}</p>
                      {d.description ? <p className="mt-1 text-xs text-gray-600">{d.description}</p> : null}
                      <p className="mt-1 text-[10px] text-gray-500">{d.relevance_reason}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {d.url ? (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold text-indigo-700 underline"
                          >
                            Open link
                          </a>
                        ) : null}
                        {d.id === RESOURCE_DROP_CALENDAR_ID ? (
                          <button type="button" className="text-xs font-semibold text-indigo-700 underline" onClick={() => { setOpen(false); onInternalCalendar(); }}>
                            Open calendar planner
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      ) : null}
      <style>{`
        @keyframes resourceDropIn {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
