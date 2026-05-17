import type { ComponentType, SVGProps } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { BookOpen, CalendarDays, Ghost, History, Home, LogOut, MessagesSquare } from 'lucide-react';
import { SlimeAdvisor } from './report/SlimeAdvisor';
import { PersonaSwitcher } from './PersonaSwitcher';
import { cn } from './ui/utils';
import { useAuth } from '../../auth/AuthContext';
import { isSupabaseEnvConfigured } from '../../auth/RequireAuthLayout';
import { SlimeCreditsChipNav } from './credits/SlimeCreditsContext';
import { DEFAULT_SLIME_PROFILE, useSlimeProfile } from '../../hooks/useSlimeProfile';
import { BuddyTooltip } from '../../features/slime/BuddyTooltip';
import { HomeResilienceNavButton } from './home/HomeResilienceNavButton';
import { BrandMark } from './BrandMark';

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
      <Icon className={cn(sz, 'shrink-0', colorClass)} strokeWidth={compact ? 2 : 1.85} />
    </span>
  );
}

/** Fixed corner: live slime preview + “Profile” label (rendered outside the pill row). */
function ProfileSlimeNav({ compact, className }: { compact: boolean; className?: string }) {
  const navigate = useNavigate();
  const { slimeProfile } = useSlimeProfile();
  const p = slimeProfile ?? DEFAULT_SLIME_PROFILE;

  return (
    <BuddyTooltip content="Open your account page with slime preview, memory, and traces.">
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
    </BuddyTooltip>
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

function isHomeNavRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  return pathname.startsWith('/trace/');
}

export function MainNavButtons({
  variant = 'default',
  layout = 'classic',
  className,
}: {
  variant?: 'default' | 'compact';
  layout?: 'classic' | 'topbar';
  /** Extra classes on the outer wrapper (e.g. margin). */
  className?: string;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const hideHome = isHomeNavRoute(pathname);
  // Avoid blocking chat/clarification controls near the bottom edge.
  const suppressFloatingCorners = pathname.startsWith('/chat') || pathname.startsWith('/reflect');
  const { session, signOut } = useAuth();
  const compact = variant === 'compact';
  const useTopbar = layout === 'topbar' && !compact;
  const btnClass = compact ? btnClassCompact : btnClassDefault;

  const btnStyle = {
    overflow: 'visible' as const,
    lineHeight: 1,
    fontWeight: compact ? 500 : 600,
  };
  const navBtnClass = (active = false) =>
    useTopbar
      ? cn(
          'inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm text-slate-700 transition-colors',
          active ? 'bg-violet-100/95 text-violet-900' : 'hover:bg-slate-200/70',
          'focus:outline-none focus:ring-2 focus:ring-violet-500/35',
        )
      : btnClass;
  const navBtnStyle = useTopbar ? undefined : btnStyle;
  const isActivePath = (base: string) =>
    base === '/' ? pathname === '/' : pathname === base || pathname.startsWith(`${base}/`);
  const iconTone = (classic: string, topbar: string) => (useTopbar ? topbar : classic);

  const homeBtn = !hideHome ? (
    <BuddyTooltip content="Go to the Foresight-X home screen and decision workspace.">
      <button type="button" onClick={() => navigate('/')} className={navBtnClass(isActivePath('/'))} style={navBtnStyle}>
        <NavIconSlot Icon={Home} compact={compact} colorClass={iconTone('text-violet-600', 'text-violet-700')} />
        Home
      </button>
    </BuddyTooltip>
  ) : null;

  const brandBtn = (
    <BuddyTooltip content="Foresight-X home">
      <button
        type="button"
        onClick={() => navigate('/')}
        className={cn(
          'inline-flex shrink-0 items-center focus:outline-none focus:ring-2 focus:ring-violet-400/40',
          useTopbar ? 'rounded-lg px-1.5 py-1 hover:bg-white/10' : 'rounded-full',
        )}
        aria-label="Open Foresight-X home"
      >
        {useTopbar ? (
          <img src="/ForesightXLogoDark.svg" alt="Foresight-X" className="h-10 w-auto sm:h-11" decoding="async" />
        ) : (
          <BrandMark compact={compact} iconOnly={compact} />
        )}
      </button>
    </BuddyTooltip>
  );

  const navPills = (
    <>
      <BuddyTooltip content="Open Shadow Chat — threaded assistant with reports, memory, and full composer.">
        <button type="button" onClick={() => navigate('/chat')} className={navBtnClass(isActivePath('/chat'))} style={navBtnStyle}>
          <NavIconSlot Icon={MessagesSquare} compact={compact} colorClass={iconTone('text-indigo-600', 'text-indigo-700')} />
          Chat
        </button>
      </BuddyTooltip>
      <BuddyTooltip content="Browse saved decision traces and past runs.">
        <button type="button" onClick={() => navigate('/history')} className={navBtnClass(isActivePath('/history'))} style={navBtnStyle}>
          <NavIconSlot Icon={History} compact={compact} colorClass={iconTone('text-purple-600', 'text-purple-700')} />
          History
        </button>
      </BuddyTooltip>
      <BuddyTooltip content="Open your diary workspace for daily notes and reflections.">
        <button type="button" onClick={() => navigate('/diary')} className={navBtnClass(isActivePath('/diary'))} style={navBtnStyle}>
          <NavIconSlot Icon={BookOpen} compact={compact} colorClass={iconTone('text-emerald-600', 'text-emerald-700')} />
          Diary
        </button>
      </BuddyTooltip>
      <BuddyTooltip content="Plan tasks and calendar blocks in the execution planner.">
        <button type="button" onClick={() => navigate('/execution')} className={navBtnClass(isActivePath('/execution'))} style={navBtnStyle}>
          <NavIconSlot Icon={CalendarDays} compact={compact} colorClass={iconTone('text-purple-600', 'text-purple-700')} />
          Calendar
        </button>
      </BuddyTooltip>
      <BuddyTooltip content="Voice-first Slime buddy — quick chat, personalization, and playful companion mode.">
        <button type="button" onClick={() => navigate('/buddy')} className={navBtnClass(isActivePath('/buddy'))} style={navBtnStyle}>
          <NavIconSlot Icon={Ghost} compact={compact} colorClass={iconTone('text-fuchsia-600', 'text-fuchsia-700')} />
          {compact ? 'Buddy' : 'Slime buddy'}
        </button>
      </BuddyTooltip>
      {isSupabaseEnvConfigured() && !session ? (
        <>
          <BuddyTooltip content="Sign in with email to sync your profile and credits.">
            <button type="button" onClick={() => navigate('/login')} className={navBtnClass(isActivePath('/login'))} style={navBtnStyle}>
              {compact ? 'Log in' : 'Sign in'}
            </button>
          </BuddyTooltip>
          <BuddyTooltip content="Create a new account.">
            <button type="button" onClick={() => navigate('/register')} className={navBtnClass(isActivePath('/register'))} style={navBtnStyle}>
              {compact ? 'Join' : 'Register'}
            </button>
          </BuddyTooltip>
        </>
      ) : null}
    </>
  );

  const scrollClass =
    'flex min-w-0 flex-1 justify-center overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]';
  return (
    <>
      <div className={cn(!compact && 'mb-8', className)}>
        {useTopbar ? (
          <>
            <div className="h-[74px] sm:h-[80px] md:h-[84px]" aria-hidden />
            <div
              data-slime-avoid
              className="fixed left-1/2 top-3 z-[70] w-[min(1500px,calc(100vw-1.5rem))] -translate-x-1/2 sm:top-4 sm:w-[min(1500px,calc(100vw-2rem))] md:top-5"
            >
              <div className="w-full rounded-2xl border border-slate-300/90 bg-white/90 px-4 py-3 shadow-[0_14px_34px_rgba(15,23,42,0.12)] backdrop-blur-md">
                <div className="grid w-full min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-4">
                  <div className="flex min-w-0 items-center justify-start">{brandBtn}</div>
                  <div className="flex min-w-0 items-center justify-center">
                    <div className="flex max-w-full items-center justify-center overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]">
                      <div className="flex w-max flex-nowrap items-center justify-center gap-1 px-1">{navPills}</div>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center justify-end gap-2">
                    <SlimeCreditsChipNav withProfile />
                    <PersonaSwitcher compact />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : !compact ? (
          <div className="flex w-full min-w-0 items-center gap-2 py-2">
            <div className="flex shrink-0 items-center gap-2">
              {brandBtn}
              {homeBtn}
              <PersonaSwitcher compact />
            </div>
            <div className={scrollClass}>
              <div className="flex w-max flex-nowrap items-center justify-center gap-2 px-1">{navPills}</div>
            </div>
            <div className="flex shrink-0 items-center self-center">
              <SlimeCreditsChipNav />
            </div>
          </div>
        ) : (
          <div className="flex w-full min-w-0 items-center gap-2 py-3 px-1">
            <div className="flex shrink-0 items-center gap-2">
              {brandBtn}
              {homeBtn}
            </div>
            <div className={scrollClass}>
              <div className="flex w-max flex-nowrap items-center justify-center gap-2">{navPills}</div>
            </div>
            <div className="flex shrink-0 items-center self-center">
              <SlimeCreditsChipNav compact />
            </div>
          </div>
        )}
      </div>
      {/* Home landing only: resilience report (FOR-17); sign out stacked when signed in */}
      {hideHome ? (
        <div
          className={cn(
            'pointer-events-none fixed z-[60] flex flex-col gap-2',
            compact ? 'bottom-4 left-4' : 'bottom-5 left-4 sm:bottom-6 sm:left-8',
          )}
        >
          <div className="pointer-events-auto">
            <HomeResilienceNavButton compact={compact} />
          </div>
          {isSupabaseEnvConfigured() && session ? (
            <BuddyTooltip content="Sign out of your account on this device.">
              <button
                type="button"
                onClick={() => void signOut().then(() => navigate(isSupabaseEnvConfigured() ? '/login' : '/'))}
                className={cn(btnClass, 'pointer-events-auto')}
                style={btnStyle}
              >
                <NavIconSlot Icon={LogOut} compact={compact} colorClass="text-slate-500" />
                {compact ? 'Out' : 'Sign out'}
              </button>
            </BuddyTooltip>
          ) : null}
        </div>
      ) : isSupabaseEnvConfigured() && session && !suppressFloatingCorners ? (
        <div
          className={cn(
            'pointer-events-none fixed z-[60]',
            compact ? 'bottom-4 left-4' : 'bottom-5 left-4 sm:bottom-6 sm:left-8',
          )}
        >
          <BuddyTooltip content="Sign out of your account on this device.">
            <button
              type="button"
              onClick={() => void signOut().then(() => navigate(isSupabaseEnvConfigured() ? '/login' : '/'))}
              className={cn(btnClass, 'pointer-events-auto')}
              style={btnStyle}
            >
              <NavIconSlot Icon={LogOut} compact={compact} colorClass="text-slate-500" />
              {compact ? 'Out' : 'Sign out'}
            </button>
          </BuddyTooltip>
        </div>
      ) : null}
      {/* Below PersonaSwitcher (z-70); clears common bottom UI */}
      {!suppressFloatingCorners && !useTopbar ? (
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
      ) : null}
    </>
  );
}
