import { cn } from '../ui/utils';
import type { AgentStatus } from './types';

const statusLabel: Record<AgentStatus, string> = {
  idle: 'Idle',
  reading_memory: 'Reading memory',
  thinking: 'Thinking',
  responding: 'Writing response',
  updating_profile: 'Updating profile',
  decision_detected: 'Decision detected',
  report_generating: 'Generating report',
  report_complete: 'Report complete',
  scheduling: 'Scheduling',
  report_open: 'Report open',
  error: 'Error',
};

export function AgentPresenceCard({
  status,
  timeline,
}: {
  status: AgentStatus;
  timeline: string[];
}) {
  return (
    <aside className="rounded-3xl border border-white/90 bg-white/65 p-4 shadow-[0_10px_28px_rgba(99,102,241,0.10)] backdrop-blur-md">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Shadow Chat</p>
      <div className="mt-2 flex items-center gap-3">
        <div
          className={cn(
            'h-4 w-4 rounded-full',
            status === 'error' ? 'bg-rose-500' : 'bg-indigo-500 animate-pulse',
          )}
        />
        <p className="text-sm text-gray-800 font-medium">{statusLabel[status]}</p>
      </div>
      <div className="mt-4 space-y-2">
        {timeline.slice(-4).map((x, i) => (
          <div key={`${x}-${i}`} className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
            {x}
          </div>
        ))}
      </div>
    </aside>
  );
}

