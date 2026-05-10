import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { Button } from '../../app/components/ui/button';
import { Input } from '../../app/components/ui/input';
import { Label } from '../../app/components/ui/label';
import { Textarea } from '../../app/components/ui/textarea';
import { cn } from '../../app/components/ui/utils';
import type { SlimeProfile } from '../../app/model';
import { apiUrl } from '../../utils/apiOrigin';
import {
  ACCESSORY_OPTIONS,
  COLOR_OPTIONS,
  fieldSelectClass,
  MOTION_OPTIONS,
  PERSONALITY_OPTIONS,
  SHAPE_OPTIONS,
  SLIME_PRESETS,
} from './slimeFormConstants';
import {
  DEFAULT_SLIME_PERSONA,
  SLIME_PERSONA_PRESET_OPTIONS,
  SLIME_TONE_OPTIONS,
  patchForPersonalityPreset,
} from './slimePersonaPresets';

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
  const [previewCtx, setPreviewCtx] = useState<'decision' | 'memory' | 'calendar' | 'casual'>('casual');
  const [previewLine, setPreviewLine] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const persona = slimeDraft.persona ?? DEFAULT_SLIME_PERSONA;

  const setPersona = (patch: Partial<typeof persona>) => {
    setSlimeDraft((s) => ({
      ...s,
      persona: { ...(s.persona ?? DEFAULT_SLIME_PERSONA), ...patch },
    }));
  };

  const runPreview = async () => {
    setPreviewBusy(true);
    setPreviewLine(null);
    try {
      const r = await fetch(apiUrl('/api/profile/slime-persona/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona: {
            userNickname: persona.userNickname,
            roleIdentity: persona.roleIdentity,
            personalityPreset: persona.personalityPreset,
            tone: persona.tone,
            warmth: persona.warmth,
            humor: persona.humor,
            directness: persona.directness,
            replyLength: persona.replyLength,
            catchphrases: persona.catchphrases,
            donts: persona.donts,
          },
          sample_context: previewCtx,
          slime_name: slimeDraft.name,
        }),
      });
      if (!r.ok) throw new Error('preview failed');
      const j = (await r.json()) as { preview_text?: string };
      setPreviewLine((j.preview_text || '').trim() || '—');
    } catch {
      setPreviewLine('Preview unavailable — try again.');
    } finally {
      setPreviewBusy(false);
    }
  };

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

      <div className="rounded-xl border border-violet-200/60 bg-gradient-to-b from-white/90 to-violet-50/40 p-3 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-wide text-violet-800">How should your Slime talk?</p>

        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700/90">Personality preset</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {SLIME_PERSONA_PRESET_OPTIONS.map((pr) => (
              <button
                key={pr.id}
                type="button"
                onClick={() => setPersona(patchForPersonalityPreset(pr.id))}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium transition',
                  persona.personalityPreset === pr.id
                    ? 'border-violet-500 bg-white shadow-sm'
                    : 'border-violet-200/70 bg-white/80 hover:border-violet-400',
                )}
              >
                {pr.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-[10px] text-gray-600">How Slime refers to you (optional)</Label>
            <Input
              value={persona.userNickname ?? ''}
              maxLength={24}
              onChange={(e) => setPersona({ userNickname: e.target.value.trim() ? e.target.value.slice(0, 24) : null })}
              placeholder="e.g. bro, boss, my friend"
              className="mt-0.5 h-9 rounded-lg border-violet-200/55 bg-white/90 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-gray-600">Speaking tone</Label>
            <select
              value={persona.tone}
              onChange={(e) => setPersona({ tone: e.target.value as (typeof persona)['tone'] })}
              className={cn(fieldSelectClass, 'mt-0.5 h-9 py-1 text-xs')}
            >
              {SLIME_TONE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <Label className="text-[10px] text-gray-600">Warmth (0–3)</Label>
            <Input
              type="range"
              min={0}
              max={3}
              step={1}
              value={persona.warmth}
              onChange={(e) => setPersona({ warmth: Number(e.target.value) as (typeof persona)['warmth'] })}
              className="mt-1 w-full accent-violet-600"
            />
            <p className="text-[10px] text-gray-500">{persona.warmth} — neutral → buddy-like</p>
          </div>
          <div>
            <Label className="text-[10px] text-gray-600">Humor (0–3)</Label>
            <Input
              type="range"
              min={0}
              max={3}
              step={1}
              value={persona.humor}
              onChange={(e) => setPersona({ humor: Number(e.target.value) as (typeof persona)['humor'] })}
              className="mt-1 w-full accent-violet-600"
            />
            <p className="text-[10px] text-gray-500">{persona.humor}</p>
          </div>
          <div>
            <Label className="text-[10px] text-gray-600">Directness (0–3)</Label>
            <Input
              type="range"
              min={0}
              max={3}
              step={1}
              value={persona.directness}
              onChange={(e) => setPersona({ directness: Number(e.target.value) as (typeof persona)['directness'] })}
              className="mt-1 w-full accent-violet-600"
            />
            <p className="text-[10px] text-gray-500">{persona.directness}</p>
          </div>
        </div>

        <div className="mt-2">
          <Label className="text-[10px] text-gray-600">Reply length</Label>
          <div className="mt-1 flex flex-wrap gap-1">
            {(
              [
                ['short', 'Short'],
                ['balanced', 'Balanced'],
                ['detailed', 'Detailed'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPersona({ replyLength: id })}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[10px] font-medium',
                  persona.replyLength === id
                    ? 'border-violet-500 bg-white'
                    : 'border-violet-200/70 bg-white/80 hover:border-violet-400',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2">
          <Label className="text-[10px] text-gray-600">Role (one line, optional)</Label>
          <Textarea
            value={persona.roleIdentity}
            maxLength={500}
            onChange={(e) => setPersona({ roleIdentity: e.target.value.slice(0, 500) })}
            className="mt-0.5 min-h-[52px] rounded-lg border-violet-200/55 bg-white/90 text-xs"
            placeholder="Who is this Slime for you?"
          />
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Label className="text-[10px] text-gray-600">Catchphrase {i + 1}</Label>
              <Input
                value={persona.catchphrases[i] ?? ''}
                maxLength={40}
                onChange={(e) => {
                  const raw = [...persona.catchphrases];
                  while (raw.length < 3) raw.push('');
                  raw[i] = e.target.value.slice(0, 40);
                  setPersona({ catchphrases: raw });
                }}
                className="mt-0.5 h-9 rounded-lg text-xs"
                placeholder="Optional"
              />
            </div>
          ))}
        </div>

        <div className="mt-2">
          <Label className="text-[10px] text-gray-600">Boundaries / don&apos;ts (one per line, max 5)</Label>
          <Textarea
            value={persona.donts.join('\n')}
            onChange={(e) =>
              setPersona({
                donts: e.target.value
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .slice(0, 5),
              })
            }
            className="mt-0.5 min-h-[64px] rounded-lg border-violet-200/55 bg-white/90 text-xs"
            placeholder={'e.g. Don\'t call me bro.'}
          />
        </div>

        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-violet-100/90 bg-white/70 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-[10px] text-gray-600">Preview sample</Label>
            <select
              value={previewCtx}
              onChange={(e) => setPreviewCtx(e.target.value as typeof previewCtx)}
              className={cn(fieldSelectClass, 'h-8 max-w-[200px] text-[10px]')}
            >
              <option value="casual">Casual recommendation</option>
              <option value="memory">Memory answer</option>
              <option value="calendar">Calendar</option>
              <option value="decision">Decision mode</option>
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={previewBusy}
              onClick={() => void runPreview()}
              className="h-8 rounded-full text-[10px]"
            >
              {previewBusy ? '…' : 'Preview'}
            </Button>
          </div>
          {previewLine !== null ? (
            <p className="text-xs italic leading-relaxed text-gray-800">
              <span className="font-semibold not-italic text-violet-800">{slimeDraft.name}:</span> {previewLine}
            </p>
          ) : null}
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
