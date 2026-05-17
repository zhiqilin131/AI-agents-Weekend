import { cn } from '../../app/components/ui/utils';
import { getSlimeIdentity, type SlimeType } from './slimeIdentity';
import { SLIME_CTA_BTN_CLASS, slimeCtaButtonStyle } from './slimeCtaButton';
import { BuddyTooltip } from './BuddyTooltip';

export function SlimeModeSwitcher({
  value,
  onChange,
  disabled = false,
  compact = false,
  className,
}: {
  value: SlimeType;
  onChange: (next: SlimeType) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const gen = getSlimeIdentity('generalized');
  const well = getSlimeIdentity('wellbeing');

  const btn = (type: SlimeType, label: string, hint: string, dot: string) => {
    const active = value === type;
    return (
      <BuddyTooltip content={hint}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(type)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium transition',
            compact ? 'text-[11px]' : 'text-xs',
            active
              ? cn('border-transparent', SLIME_CTA_BTN_CLASS)
              : 'border-gray-200/90 bg-white/90 text-gray-700 hover:border-gray-300',
            disabled && 'pointer-events-none opacity-50',
          )}
          style={
            active ? slimeCtaButtonStyle(getSlimeIdentity(type).theme) : undefined
          }
          aria-pressed={active}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.35)]"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${getSlimeIdentity(type).theme.highlight}, ${dot})`,
            }}
            aria-hidden
          />
          {label}
        </button>
      </BuddyTooltip>
    );
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {btn('generalized', gen.shortName, gen.tagline, gen.theme.primary)}
        {btn('wellbeing', well.shortName, well.tagline, well.theme.primary)}
      </div>
      <p className={cn('leading-snug text-gray-600', compact ? 'text-[10px]' : 'text-[11px]')}>
        {value === 'wellbeing' ? well.tagline : gen.tagline}
      </p>
    </div>
  );
}
