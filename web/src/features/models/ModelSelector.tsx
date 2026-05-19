import { useEffect, useState, type ReactNode } from 'react';
import { Cpu, Sparkles } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../app/components/ui/select';
import { cn } from '../../app/components/ui/utils';
import { fetchCostPreview } from './slimeModelsApi';
import type { SlimeCreditFeature, SlimeModelRow } from './types';

type Props = {
  feature: SlimeCreditFeature;
  selectedModelId: string;
  onChange: (id: string) => void;
  models: SlimeModelRow[];
  selectorEnabled: boolean;
  /** When false, hide if only one tier exists. Default true so every surface shows the control. */
  showWhenSingle?: boolean;
  showCostPreview?: boolean;
  variant?: 'compact' | 'cards' | 'panel';
  /** When false, use inline layout without the glass card wrapper (toolbar-only). */
  elevated?: boolean;
  /** Short heading (compact/panel). */
  label?: string;
  /** One line under the heading. */
  hint?: string;
  /** Compact only: hide sparkle icon + label + hint row (dropdown only). */
  hideCompactHeader?: boolean;
  /** When ``hideCompactHeader``, accessible name for the trigger. */
  compactSelectAriaLabel?: string;
  /** Optional SelectContent class override for specific stacking contexts. */
  selectContentClassName?: string;
  /** Optional preferred open side for SelectContent. */
  selectContentSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Optional collision behavior override for SelectContent. */
  selectContentAvoidCollisions?: boolean;
  className?: string;
  disabled?: boolean;
};

export function ModelSelector({
  feature,
  selectedModelId,
  onChange,
  models,
  selectorEnabled,
  showWhenSingle = true,
  showCostPreview = true,
  variant = 'compact',
  elevated = true,
  label = 'Slime model',
  hint = 'Higher tiers use more credits per action. Default is the most efficient tier.',
  hideCompactHeader = false,
  compactSelectAriaLabel,
  selectContentClassName,
  selectContentSide,
  selectContentAvoidCollisions,
  className,
  disabled = false,
}: Props) {
  const [previewCost, setPreviewCost] = useState<number | null>(null);
  const [previewErr, setPreviewErr] = useState(false);

  useEffect(() => {
    if (!showCostPreview || !selectedModelId) {
      setPreviewCost(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const p = await fetchCostPreview(feature, selectedModelId);
        if (!cancelled) {
          setPreviewCost(p.final_cost);
          setPreviewErr(false);
        }
      } catch {
        if (!cancelled) {
          setPreviewCost(null);
          setPreviewErr(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feature, selectedModelId, showCostPreview]);

  if (!selectorEnabled || models.length === 0) {
    return null;
  }
  if (models.length < 2 && !showWhenSingle) {
    return null;
  }

  const selected = models.find((m) => m.id === selectedModelId) ?? models[0];
  const triggerLabel =
    previewCost != null && !previewErr
      ? `${selected?.display_name ?? selectedModelId} · ${previewCost} credits`
      : (selected?.display_name ?? selectedModelId);

  const shellWrap = (inner: ReactNode) => (
    <div
      className={cn(
        'rounded-2xl border border-indigo-200/50 bg-gradient-to-br from-white/95 via-violet-50/40 to-indigo-50/30',
        'p-3 shadow-[0_12px_40px_rgba(99,102,241,0.12)] backdrop-blur-md',
        className,
      )}
    >
      {inner}
    </div>
  );

  if (variant === 'cards') {
    return shellWrap(
      <div>
        <div className="mb-2 flex items-start gap-2">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600">
            <Cpu className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600/90">{label}</p>
            {hint.trim() ? <p className="text-[11px] leading-snug text-slate-600">{hint}</p> : null}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {models.map((m) => {
            const active = m.id === selectedModelId;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange(m.id)}
                className={cn(
                  'rounded-xl border p-3 text-left text-sm transition-all duration-200',
                  active
                    ? 'border-indigo-400/90 bg-white/95 shadow-[0_8px_28px_rgba(99,102,241,0.18)] ring-1 ring-indigo-300/40'
                    : 'border-white/80 bg-white/70 hover:border-indigo-200/90 hover:bg-white/90 hover:shadow-md',
                  disabled && 'pointer-events-none opacity-50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{m.display_name}</span>
                  {m.badge ? (
                    <span className="rounded-full bg-indigo-100/90 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                      {m.badge}
                    </span>
                  ) : null}
                </div>
                {(m.engine || '').trim() ? (
                  <p className="mt-1.5 font-mono text-[11px] font-semibold tracking-tight text-indigo-950">
                    {(m.engine || '').trim()}
                  </p>
                ) : null}
                <p className="mt-1 text-xs leading-snug text-slate-600">{m.description}</p>
                {m.best_for?.length ? (
                  <p className="mt-1 text-[10px] text-slate-500">Best for: {m.best_for.slice(0, 4).join(' · ')}</p>
                ) : null}
                <p className="mt-2 text-[11px] font-semibold text-indigo-800">{m.credit_multiplier}× base cost</p>
              </button>
            );
          })}
        </div>
      </div>,
    );
  }

  const selectColumn = (
    <div className={cn('w-full min-w-0', !hideCompactHeader && 'sm:max-w-[min(20rem,42vw)] sm:flex-none')}>
      <Select value={selectedModelId} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          size="sm"
          aria-label={hideCompactHeader ? (compactSelectAriaLabel || 'Slime model tier') : undefined}
          className={cn(
            'h-10 w-full rounded-xl border-indigo-200/70 bg-white/90 text-left text-xs font-medium text-indigo-950',
            'shadow-inner shadow-indigo-100/40 transition hover:border-indigo-300/80 focus:ring-indigo-300/30',
          )}
        >
          <SelectValue placeholder="Model">{triggerLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent
          side={selectContentSide}
          avoidCollisions={selectContentAvoidCollisions}
          className={cn(
            'max-w-md rounded-xl border-indigo-100/80 bg-white/95 backdrop-blur-md',
            selectContentClassName,
          )}
        >
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id} className="rounded-lg text-xs">
              <span className="font-medium text-slate-900">{m.display_name}</span>
              {(m.engine || '').trim() ? (
                <span className="text-slate-600"> · {(m.engine || '').trim()}</span>
              ) : null}
              <span className="text-slate-500"> · {m.credit_multiplier}×</span>
              {m.badge ? <span className="ml-1 text-[10px] text-indigo-600">({m.badge})</span> : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showCostPreview && previewErr ? (
        <span className="mt-1 block text-[10px] text-amber-700">Could not load cost preview.</span>
      ) : null}
      {showCostPreview && previewCost != null && !previewErr ? (
        <span className="mt-1.5 inline-flex items-center rounded-full border border-indigo-100/80 bg-indigo-50/60 px-2 py-0.5 text-[10px] font-medium text-indigo-900">
          ~{previewCost} credits for this action type
        </span>
      ) : null}
    </div>
  );

  const compactBody = hideCompactHeader ? (
    selectColumn
  ) : (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600/90">{label}</p>
        </div>
        {hint.trim() ? <p className="text-[11px] leading-snug text-slate-600">{hint}</p> : null}
      </div>
      {selectColumn}
    </div>
  );

  if (variant === 'panel' || (variant === 'compact' && elevated)) {
    return shellWrap(compactBody);
  }

  return <div className={cn('flex flex-col gap-1', className)}>{compactBody}</div>;
}
