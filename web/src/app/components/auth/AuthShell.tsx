import type { ReactNode } from 'react';
import { HomeRoamingSlime } from '../home/HomeRoamingSlime';

const BRAND_SUBTITLE = 'Evidence-grounded decision agent';

/** Shown on auth gate pages (login / register). */
const APP_VERSION_DISPLAY = 'V1.0.0';

export function AuthShell({
  children,
  showRoamingSlime = true,
}: {
  children: ReactNode;
  showRoamingSlime?: boolean;
}) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-10 top-20 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-purple-300/30 to-pink-300/30 blur-3xl" />
        <div className="absolute bottom-20 right-10 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-blue-300/30 to-purple-300/30 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-purple-200/20 to-blue-200/20 blur-3xl" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6">
        <div className="relative z-[40] w-full max-w-[420px]">{children}</div>
      </div>

      {showRoamingSlime ? <HomeRoamingSlime variant="auth" /> : null}

      <p
        className="pointer-events-none fixed bottom-3 left-3 z-[50] text-[0.95rem] leading-none text-violet-950/40 sm:bottom-4 sm:left-4 sm:text-[1.05rem]"
        style={{ fontFamily: "'Great Vibes', cursive" }}
        aria-label={`Version ${APP_VERSION_DISPLAY}`}
      >
        {APP_VERSION_DISPLAY}
      </p>
    </div>
  );
}

export function AuthFormCard({
  title,
  subtitle = BRAND_SUBTITLE,
  children,
  footer,
}: {
  title: string;
  subtitle?: string | null;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border border-white/90 bg-white/75 p-8 shadow-[0_20px_60px_rgba(99,102,241,0.14)] backdrop-blur-xl ring-1 ring-violet-100/40 sm:p-10"
      data-testid="auth-form-card"
    >
      <div className="mb-8 flex flex-col items-center gap-5 text-center">
        <img src="/ForesightXLogoDark.svg" alt="Foresight-X" className="h-10 w-auto select-none md:h-12" />
        <div>
          <h1
            className="text-2xl tracking-tight text-gray-900 md:text-[1.75rem]"
            style={{ fontWeight: 700, letterSpacing: '-0.03em' }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm text-gray-500 md:text-base" style={{ fontWeight: 400 }}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {children}
      {footer ? <div className="mt-6 border-t border-gray-200/60 pt-6">{footer}</div> : null}
    </div>
  );
}

export { BRAND_SUBTITLE };
