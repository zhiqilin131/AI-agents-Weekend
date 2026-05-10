import type { ComponentType, SVGProps } from 'react';
import { useNavigate } from 'react-router';
import { BookOpen, CalendarDays, Ghost, History, LogOut, MessagesSquare } from 'lucide-react';
import { SlimeAdvisor } from './report/SlimeAdvisor';
import { PersonaSwitcher } from './PersonaSwitcher';
import { cn } from './ui/utils';
import { useAuth } from '../../auth/AuthContext';
import { isSupabaseEnvConfigured, supabaseGateEnabled } from '../../auth/RequireAuthLayout';
import { DEFAULT_SLIME_PROFILE, useSlimeProfile } from '../../hooks/useSlimeProfile';

type NavIconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

/** Fixed slot so Lucide stroke never hits the button edge (global `button { line-height: 1.5 }` + scrollports clip). */
function NavIconSlot({
  Icon,
  compact,
  colorClass,
}: {
  Icon: NavIconComponent;
  compact: boolean;
  colorClass: string;
}) {
  const box = compact ? 'h-[18px] w-[18px]' : 'h-[22px] w-[22px]';
  const sz = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center overflow-visible', box)} aria-hidden>
      <Icon className={cn(sz, 'shrink-0', colorClass)} strokeWidth={compact ? 2 : 1.85} absoluteStrokeWidth={false} />
    </span>
  );
}

/** Fixed corner: live slime preview + “Profile” label (rendered outside the pill row). */
function ProfileSlimeNav({ compact, className }: { compact: boolean; className?: string }) {
  const navigate = useNavigate();
  const { slimeProfile } = useSlimeProfile();
  const p = slimeProfile ?? DEFAULT_SLIME_PROFILE;

  return (
    <button
      type="button"
      onClick={() => navigate('/profile')}
      className={cn(
        'flex shrink-0 flex-col items-center justify-center rounded-2xl border border-violet-200/85 bg-white/95 shadow-md backdrop-blur-md transition hover:border-violet-400 hover:bg-white hover:shadow-lg',
        compact ? 'px-1.5 py-1' : 'px-2.5 py-2',
        className,
      )}
      style={{ overflow: 'visible', lineHeight: 1 }}
      aria-label="Profile"
    >
      <div
        className={cn(
          'relative flex items-center justify-center overflow-visible',
          compact ? 'h-9 w-9' : 'h-11 w-11',
        )}
      >
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 top-1/2 origin-center -translate-x-1/2 -translate-y-1/2 scale-[0.34]',
            compact && 'scale-[0.28]',
          )}
        >
          <SlimeAdvisor state="idle" size="sm" profile={p} />
        </div>
      </div>
      <span className={cn('mt-0.5 font-semibold tracking-tight text-gray-800', compact ? 'text-[9px]' : 'text-[10px]')}>
        Profile
      </span>
    </button>
  );
}

const btnClassDefault =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/90 bg-white/80 px-4 py-2.5 text-sm ' +
  'text-gray-800 shadow-sm backdrop-blur-sm transition-all hover:border-purple-200/80 hover:bg-white hover:shadow-md ' +
  'focus:outline-none focus:ring-2 focus:ring-purple-400/40';

const btnClassCompact =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3 py-2 text-xs ' +
  'font-medium text-slate-700 shadow-sm transition-colors hover:border-indigo-200 hover:bg-slate-50 ' +
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
  const { session, signOut } = useAuth();
  const compact = variant === 'compact';
  const btnClass = compact ? btnClassCompact : btnClassDefault;

  const btnStyle = {
    overflow: 'visible' as const,
    lineHeight: 1,
    fontWeight: compact ? 500 : 600,
  };

  return (
    <>
      <div className={cn(!compact && 'mb-8', className)}>
        {!compact ? <PersonaSwitcher compact /> : null}
        <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]">
          {/* w-max + mx-auto: centered when the row fits; scroll horizontally when it doesn’t */}
          <div className="mx-auto flex w-max flex-nowrap items-center gap-2 py-3 px-1">
            <button type="button" onClick={() => navigate('/chat')} className={btnClass} style={btnStyle}>
              <NavIconSlot Icon={MessagesSquare} compact={compact} colorClass="text-indigo-600" />
              Chat
            </button>
            <button type="button" onClick={() => navigate('/history')} className={btnClass} style={btnStyle}>
              <NavIconSlot Icon={History} compact={compact} colorClass="text-purple-600" />
              History
            </button>
            <button type="button" onClick={() => navigate('/diary')} className={btnClass} style={btnStyle}>
              <NavIconSlot Icon={BookOpen} compact={compact} colorClass="text-emerald-600" />
              Diary
            </button>
            <button type="button" onClick={() => navigate('/execution')} className={btnClass} style={btnStyle}>
              <NavIconSlot Icon={CalendarDays} compact={compact} colorClass="text-purple-600" />
              Calendar
            </button>
            <button type="button" onClick={() => navigate('/buddy')} className={btnClass} style={btnStyle}>
              <NavIconSlot Icon={Ghost} compact={compact} colorClass="text-fuchsia-600" />
              {compact ? 'Buddy' : 'Slime buddy'}
            </button>
            {isSupabaseEnvConfigured() && !session ? (
              <>
                <button type="button" onClick={() => navigate('/login')} className={btnClass} style={btnStyle}>
                  {compact ? 'Log in' : 'Sign in'}
                </button>
                <button type="button" onClick={() => navigate('/register')} className={btnClass} style={btnStyle}>
                  {compact ? 'Join' : 'Register'}
                </button>
              </>
            ) : null}
            {isSupabaseEnvConfigured() && session ? (
              <button
                type="button"
                onClick={() => void signOut().then(() => navigate(supabaseGateEnabled() ? '/login' : '/'))}
                className={btnClass}
                style={btnStyle}
                title="Sign out"
              >
                <NavIconSlot Icon={LogOut} compact={compact} colorClass="text-slate-500" />
                {compact ? 'Out' : 'Sign out'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {/* Below PersonaSwitcher (z-70); clears common bottom UI */}
      <div
        className={cn(
          'pointer-events-none fixed z-[60]',
          compact ? 'bottom-4 right-4' : 'bottom-5 right-5 sm:bottom-6 sm:right-8',
        )}
      >
        <div className="pointer-events-auto">
          <ProfileSlimeNav compact={compact} className="ring-1 ring-violet-200/60" />
        </div>
      </div>
    </>
  );
}
