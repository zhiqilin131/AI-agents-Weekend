import { motion } from 'motion/react';
import {
  Activity,
  FlaskConical,
  GitBranch,
  Globe,
  Server,
  Shield,
  Sparkles,
  User,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import {
  RESILIENCE_NODES,
  type NodeStatus,
  type ResilienceNodeId,
  type ResilienceScenario,
  nodeStatusFor,
} from './resilienceModel';

const ICONS: Record<string, LucideIcon> = {
  user: User,
  api: Server,
  pipeline: GitBranch,
  llm: Sparkles,
  search: Globe,
  mcp: Activity,
  shield: Shield,
  flask: FlaskConical,
};

function statusStyles(status: NodeStatus): string {
  switch (status) {
    case 'stress':
      return 'border-rose-300 bg-white text-rose-950 shadow-[0_0_0_1px_rgba(244,63,94,0.2),0_8px_24px_rgba(244,63,94,0.12)]';
    case 'fallback':
      return 'border-amber-300 bg-white text-amber-950 shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_8px_20px_rgba(245,158,11,0.1)]';
    case 'bypass':
      return 'border-slate-200 bg-slate-50/90 text-slate-600';
    default:
      return 'border-emerald-200/90 bg-white text-emerald-950 shadow-[0_4px_16px_rgba(16,185,129,0.08)]';
  }
}

function statusLabel(status: NodeStatus): string {
  switch (status) {
    case 'stress':
      return 'Fault';
    case 'fallback':
      return 'Fallback';
    case 'bypass':
      return 'Bypass';
    default:
      return 'OK';
  }
}

function iconTone(status: NodeStatus): string {
  switch (status) {
    case 'stress':
      return 'bg-rose-100 text-rose-600';
    case 'fallback':
      return 'bg-amber-100 text-amber-700';
    case 'bypass':
      return 'bg-slate-100 text-slate-500';
    default:
      return 'bg-violet-100 text-violet-600';
  }
}

export function ResilienceNodeCard({
  nodeId,
  scenario,
  selected,
  onSelect,
  caption,
  stageOrder,
  layout = 'tile',
}: {
  nodeId: ResilienceNodeId;
  scenario: ResilienceScenario;
  selected: boolean;
  onSelect: () => void;
  caption?: string;
  stageOrder?: number;
  layout?: 'tile' | 'wide' | 'compact';
}) {
  const node = RESILIENCE_NODES[nodeId];
  const status = nodeStatusFor(scenario, nodeId);
  const Icon = ICONS[node.icon] ?? GitBranch;
  const isStage = nodeId.startsWith('stage_');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group text-left transition-all duration-200',
        layout === 'wide' && 'w-full max-w-[11rem]',
        layout === 'tile' && 'w-[5.75rem] sm:w-[6.5rem]',
        layout === 'compact' && 'w-full',
        selected && 'z-10 scale-[1.03]',
      )}
    >
      <motion.div
        layout
        className={cn(
          'relative flex flex-col items-center rounded-2xl border px-2.5 py-3',
          layout === 'compact' && 'flex-row items-center gap-3 px-3 py-2.5',
          layout === 'wide' && 'items-start px-3.5 py-3 text-left',
          statusStyles(status),
          selected && 'ring-2 ring-violet-500/50 ring-offset-2 ring-offset-white',
        )}
        animate={status === 'stress' ? { scale: [1, 1.02, 1] } : { scale: 1 }}
        transition={{ duration: 1.4, repeat: status === 'stress' ? Infinity : 0 }}
      >
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-xl',
            layout === 'compact' ? 'h-9 w-9' : 'h-10 w-10',
            iconTone(status),
          )}
        >
          <Icon className={cn(layout === 'compact' ? 'h-4 w-4' : 'h-5 w-5')} strokeWidth={2} aria-hidden />
        </span>

        <div
          className={cn(
            'min-w-0',
            layout === 'compact' ? 'flex-1' : 'mt-2 w-full text-center',
            layout === 'wide' && 'mt-2 text-left',
          )}
        >
          {stageOrder != null ? (
            <span className="text-[10px] font-bold uppercase tracking-wide text-violet-500">Stage {stageOrder}</span>
          ) : null}
          <p className={cn('font-semibold leading-tight text-gray-900', layout === 'compact' ? 'text-sm' : 'text-xs')}>
            {isStage ? node.label : node.short}
          </p>
          {caption ? (
            <p className={cn('mt-0.5 text-[10px] leading-snug text-gray-500', layout === 'wide' && 'text-left')}>
              {caption}
            </p>
          ) : (
            <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-gray-400">{statusLabel(status)}</p>
          )}
        </div>
      </motion.div>
    </button>
  );
}

export function FlowConnector({ direction = 'down' }: { direction?: 'down' | 'right' }) {
  if (direction === 'right') {
    return (
      <svg
        className="mx-1.5 h-5 w-9 shrink-0 text-violet-400/90"
        viewBox="0 0 36 20"
        fill="none"
        aria-hidden
      >
        <path d="M2 10h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M20 5l6 5-6 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg className="my-1.5 h-8 w-5 shrink-0 text-violet-400/90" viewBox="0 0 20 32" fill="none" aria-hidden>
      <path d="M10 2v20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M5 18l5 6 5-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
