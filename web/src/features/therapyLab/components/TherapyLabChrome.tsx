import type { ReactNode } from 'react';
import { getSlimeIdentity } from '../../slime/slimeIdentity';
import { cn } from '../../../app/components/ui/utils';

const theme = getSlimeIdentity('wellbeing').theme;

export function TherapyLabPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('rounded-2xl border backdrop-blur-md', className)}
      style={{
        borderColor: `${theme.border}66`,
        background: `linear-gradient(165deg, rgba(255,255,255,0.97), ${theme.highlight})`,
        boxShadow: '0 8px 28px rgba(15, 23, 42, 0.06)',
      }}
    >
      {children}
    </div>
  );
}

export function TherapyLabPrimaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 active:brightness-95 disabled:opacity-50',
        className,
      )}
      style={{
        background: `linear-gradient(135deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
        boxShadow: `0 4px 14px ${theme.ctaGlow}`,
      }}
    >
      {children}
    </button>
  );
}

export function TherapyLabGhostButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-white/90 px-3 py-2 text-sm font-medium transition hover:bg-white disabled:opacity-50',
        className,
      )}
      style={{ borderColor: `${theme.border}88`, color: theme.heading }}
    >
      {children}
    </button>
  );
}

export function TherapyLabStepCard({
  title,
  children,
  stepIndex,
  stepTotal,
}: {
  title: string;
  children: ReactNode;
  stepIndex?: number;
  stepTotal?: number;
}) {
  return (
    <TherapyLabPanel className="p-5">
      {stepIndex != null && stepTotal != null ? (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: theme.primary }}>
          Step {stepIndex} of {stepTotal}
        </p>
      ) : null}
      <h3 className="text-lg font-semibold tracking-tight" style={{ color: theme.heading }}>
        {title}
      </h3>
      <div className="mt-4 space-y-4">{children}</div>
    </TherapyLabPanel>
  );
}

export function IntensitySlider({
  value,
  onChange,
  label = 'How intense does it feel right now? (0–10)',
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">{label}</label>
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-rose-400"
      />
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>0 calm</span>
        <span className="font-semibold text-rose-800">{value}/10</span>
        <span>10 very intense</span>
      </div>
    </div>
  );
}

export { theme as therapyLabTheme };
