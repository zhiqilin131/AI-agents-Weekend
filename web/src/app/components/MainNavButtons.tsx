import { useNavigate } from 'react-router';
import { CalendarDays, History, MessagesSquare, Sparkles, UserCircle } from 'lucide-react';
import { PersonaSwitcher } from './PersonaSwitcher';
import { cn } from './ui/utils';

const btnClassDefault =
  'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm ' +
  'bg-white/80 backdrop-blur-sm border border-white/90 text-gray-800 shadow-sm ' +
  'hover:bg-white hover:shadow-md hover:border-purple-200/80 transition-all ' +
  'focus:outline-none focus:ring-2 focus:ring-purple-400/40';

const btnClassCompact =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ' +
  'bg-white border border-slate-200/90 text-slate-700 shadow-sm ' +
  'hover:bg-slate-50 hover:border-indigo-200 transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-400/30';

export function MainNavButtons({
  variant = 'default',
  className,
}: {
  variant?: 'default' | 'compact';
  /** Extra classes on the outer wrapper (e.g. margin). */
  className?: string;
}) {
  const navigate = useNavigate();
  const compact = variant === 'compact';
  const btnClass = compact ? btnClassCompact : btnClassDefault;
  const iconClass = compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0';

  return (
    <div className={cn(!compact && 'mb-8', className)}>
      {!compact ? <PersonaSwitcher compact /> : null}
      <div className={`flex flex-wrap ${compact ? 'gap-1.5 justify-start' : 'gap-3 justify-center'}`}>
        <button type="button" onClick={() => navigate('/chat')} className={btnClass} style={{ fontWeight: compact ? 500 : 600 }}>
          <MessagesSquare className={`${iconClass} text-indigo-600`} aria-hidden />
          Chat
        </button>
        <button type="button" onClick={() => navigate('/personalize')} className={btnClass} style={{ fontWeight: compact ? 500 : 600 }}>
          <Sparkles className={`${iconClass} text-violet-600`} aria-hidden />
          Personalize
        </button>
        <button type="button" onClick={() => navigate('/history')} className={btnClass} style={{ fontWeight: compact ? 500 : 600 }}>
          <History className={`${iconClass} text-purple-600`} aria-hidden />
          History
        </button>
        <button type="button" onClick={() => navigate('/execution')} className={btnClass} style={{ fontWeight: compact ? 500 : 600 }}>
          <CalendarDays className={`${iconClass} text-purple-600`} aria-hidden />
          {compact ? 'Calendar' : 'Execution Calendar'}
        </button>
        <button type="button" onClick={() => navigate('/profile')} className={btnClass} style={{ fontWeight: compact ? 500 : 600 }}>
          <UserCircle className={`${iconClass} text-purple-600`} aria-hidden />
          Profile
        </button>
      </div>
    </div>
  );
}
