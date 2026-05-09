import type { Dispatch, SetStateAction } from 'react';
import { Button } from '../../app/components/ui/button';
import { Input } from '../../app/components/ui/input';
import { Label } from '../../app/components/ui/label';
import { cn } from '../../app/components/ui/utils';
import type { SlimeProfile } from '../../app/model';
import {
  ACCESSORY_OPTIONS,
  COLOR_OPTIONS,
  fieldSelectClass,
  MOTION_OPTIONS,
  PERSONALITY_OPTIONS,
  SHAPE_OPTIONS,
  SLIME_PRESETS,
} from './slimeFormConstants';

export function SlimePersonalizationForm({
  slimeDraft,
  setSlimeDraft,
  browserVoices,
  onSave,
  onReset,
  idPrefix = 'slime',
}: {
  slimeDraft: SlimeProfile;
  setSlimeDraft: Dispatch<SetStateAction<SlimeProfile>>;
  browserVoices: string[];
  onSave: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
  idPrefix?: string;
}) {
  const nameId = `${idPrefix}-name`;

  return (
    <div className="min-w-0 space-y-3 pb-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700/90">Quick presets</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SLIME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setSlimeDraft((s) => ({ ...s, ...preset.patch }))}
              className="rounded-full border border-violet-200/70 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-violet-950 hover:border-violet-400"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor={nameId} className="text-xs text-gray-700">
          Name
        </Label>
        <Input
          id={nameId}
          value={slimeDraft.name}
          maxLength={24}
          onChange={(e) => setSlimeDraft((s) => ({ ...s, name: e.target.value }))}
          className="mt-1 h-9 rounded-lg border-violet-200/55 bg-white/90 text-sm"
          placeholder="Mochi"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-gray-800">Theme</p>
        <div className="mt-1.5 flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
          {COLOR_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              title={o.label}
              onClick={() => setSlimeDraft((s) => ({ ...s, colorTheme: o.id }))}
              className={cn(
                'flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[11px] font-medium transition',
                slimeDraft.colorTheme === o.id
                  ? 'border-violet-500 bg-white shadow-sm ring-1 ring-violet-300/60'
                  : 'border-violet-200/60 bg-white/80 hover:border-violet-300',
              )}
            >
              <span className={cn('h-6 w-6 shrink-0 rounded-full ring-1 ring-white', o.swatch)} />
              <span className="text-gray-800">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {slimeDraft.colorTheme === 'custom' ? (
        <div className="grid grid-cols-3 gap-2">
          <Input
            value={slimeDraft.customColors?.primary ?? '#a78bfa'}
            onChange={(e) =>
              setSlimeDraft((s) => ({
                ...s,
                customColors: {
                  primary: e.target.value,
                  secondary: s.customColors?.secondary ?? '#818cf8',
                  glow: s.customColors?.glow ?? '#38bdf8',
                },
              }))
            }
            className="h-9 rounded-lg font-mono text-xs"
            placeholder="#primary"
          />
          <Input
            value={slimeDraft.customColors?.secondary ?? '#818cf8'}
            onChange={(e) =>
              setSlimeDraft((s) => ({
                ...s,
                customColors: {
                  primary: s.customColors?.primary ?? '#a78bfa',
                  secondary: e.target.value,
                  glow: s.customColors?.glow ?? '#38bdf8',
                },
              }))
            }
            className="h-9 rounded-lg font-mono text-xs"
            placeholder="#secondary"
          />
          <Input
            value={slimeDraft.customColors?.glow ?? '#38bdf8'}
            onChange={(e) =>
              setSlimeDraft((s) => ({
                ...s,
                customColors: {
                  primary: s.customColors?.primary ?? '#a78bfa',
                  secondary: s.customColors?.secondary ?? '#818cf8',
                  glow: e.target.value,
                },
              }))
            }
            className="h-9 rounded-lg font-mono text-xs"
            placeholder="#glow"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div>
          <Label className="text-[10px] text-gray-600">Personality</Label>
          <select
            value={slimeDraft.personality}
            onChange={(e) => setSlimeDraft((s) => ({ ...s, personality: e.target.value as SlimeProfile['personality'] }))}
            className={cn(fieldSelectClass, 'mt-0.5 h-9 py-1 text-xs')}
          >
            {PERSONALITY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-600">Shape</Label>
          <select
            value={slimeDraft.shape}
            onChange={(e) => setSlimeDraft((s) => ({ ...s, shape: e.target.value as SlimeProfile['shape'] }))}
            className={cn(fieldSelectClass, 'mt-0.5 h-9 py-1 text-xs')}
          >
            {SHAPE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-600">Accessory</Label>
          <select
            value={slimeDraft.accessory}
            onChange={(e) => setSlimeDraft((s) => ({ ...s, accessory: e.target.value as SlimeProfile['accessory'] }))}
            className={cn(fieldSelectClass, 'mt-0.5 h-9 py-1 text-xs')}
          >
            {ACCESSORY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-600">Motion</Label>
          <select
            value={slimeDraft.motion}
            onChange={(e) => setSlimeDraft((s) => ({ ...s, motion: e.target.value as SlimeProfile['motion'] }))}
            className={cn(fieldSelectClass, 'mt-0.5 h-9 py-1 text-xs')}
          >
            {MOTION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-violet-100/80 bg-white/60 p-2.5">
        <p className="text-[11px] font-medium text-gray-800">Read aloud (reports)</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            value={slimeDraft.voice?.enabled === false ? 'disabled' : 'enabled'}
            onChange={(e) =>
              setSlimeDraft((s) => ({
                ...s,
                voice: {
                  enabled: e.target.value === 'enabled',
                  rate: s.voice?.rate ?? 1,
                  pitch: s.voice?.pitch ?? 1,
                  preferredVoiceName: s.voice?.preferredVoiceName,
                },
              }))
            }
            className={cn(fieldSelectClass, 'h-9 text-xs')}
          >
            <option value="enabled">On</option>
            <option value="disabled">Off</option>
          </select>
          <Input
            type="number"
            min={0.5}
            max={2}
            step={0.1}
            value={slimeDraft.voice?.rate ?? 1}
            onChange={(e) =>
              setSlimeDraft((s) => ({
                ...s,
                voice: {
                  enabled: s.voice?.enabled !== false,
                  rate: Number(e.target.value),
                  pitch: s.voice?.pitch ?? 1,
                  preferredVoiceName: s.voice?.preferredVoiceName,
                },
              }))
            }
            className="h-9 text-xs"
          />
          <Input
            type="number"
            min={0.5}
            max={2}
            step={0.1}
            value={slimeDraft.voice?.pitch ?? 1}
            onChange={(e) =>
              setSlimeDraft((s) => ({
                ...s,
                voice: {
                  enabled: s.voice?.enabled !== false,
                  rate: s.voice?.rate ?? 1,
                  pitch: Number(e.target.value),
                  preferredVoiceName: s.voice?.preferredVoiceName,
                },
              }))
            }
            className="h-9 text-xs"
          />
        </div>
        {browserVoices.length > 0 ? (
          <select
            value={slimeDraft.voice?.preferredVoiceName ?? ''}
            onChange={(e) => {
              const name = e.target.value;
              setSlimeDraft((s) => ({
                ...s,
                voice: {
                  enabled: s.voice?.enabled !== false,
                  rate: s.voice?.rate ?? 1,
                  pitch: s.voice?.pitch ?? 1,
                  preferredVoiceName: name || undefined,
                },
              }));
            }}
            className={cn(fieldSelectClass, 'mt-2 h-9 text-xs')}
          >
            <option value="">System voice: default</option>
            {browserVoices.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          onClick={() => void onSave()}
          className="rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-xs font-semibold text-white shadow-sm"
        >
          Save slime
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onReset()} className="rounded-full text-xs">
          Reset
        </Button>
      </div>
    </div>
  );
}
