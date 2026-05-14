import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '../../app/components/ui/button';
import { Input } from '../../app/components/ui/input';
import { Label } from '../../app/components/ui/label';
import { Textarea } from '../../app/components/ui/textarea';
import { cn } from '../../app/components/ui/utils';
import type { SlimeCompanionRelationship, SlimeProfile } from '../../app/model';
import { apiFetch } from '../../utils/apiFetch';
import { ModelSelector } from '../models/ModelSelector';
import { useSlimeModelCatalog } from '../models/useSlimeModelCatalog';
import { BuddyTooltip } from './BuddyTooltip';
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
import { normalizeTtsVoiceName, OPENAI_TTS_VOICES } from '../../utils/ttsVoices';

const RELATIONSHIP_OPTIONS: Array<{ id: SlimeCompanionRelationship; label: string }> = [
  { id: 'helper_pet_companion', label: 'Helper + pet + companion (default)' },
  { id: 'helper', label: 'Helper' },
  { id: 'pet', label: 'Pet' },
  { id: 'companion', label: 'Companion' },
  { id: 'coach', label: 'Coach' },
  { id: 'tiny_robot_slime_assistant', label: 'Tiny robot / slime assistant' },
  { id: 'assistant', label: 'Assistant' },
];

const DEFAULT_CUSTOM_COLORS = { primary: '#a78bfa', secondary: '#818cf8', glow: '#38bdf8' } as const;

/** ``<input type="color">`` only accepts #rrggbb; coerce shorthand or fall back. */
function hexForColorInput(raw: string | undefined, fallback: string): string {
  const t = (raw ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const x = t.slice(1);
    return `#${x[0]}${x[0]}${x[1]}${x[1]}${x[2]}${x[2]}`.toLowerCase();
  }
  return fallback;
}

export function SlimePersonalizationForm({
  slimeDraft,
  setSlimeDraft,
  onSave,
  onReset,
  idPrefix = 'slime',
}: {
  slimeDraft: SlimeProfile;
  setSlimeDraft: Dispatch<SetStateAction<SlimeProfile>>;
  onSave: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
  idPrefix?: string;
}) {
  const nameId = `${idPrefix}-name`;
  const slimeModels = useSlimeModelCatalog();
  const [previewModelOptionId, setPreviewModelOptionId] = useState('');
  const [previewCtx, setPreviewCtx] = useState<'decision' | 'memory' | 'calendar' | 'casual'>('casual');
  const [previewLine, setPreviewLine] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    if (slimeModels.ready && slimeModels.defaultModel && !previewModelOptionId) {
      setPreviewModelOptionId(slimeModels.defaultModel);
    }
  }, [slimeModels.ready, slimeModels.defaultModel, previewModelOptionId]);

  const persona = slimeDraft.persona ?? DEFAULT_SLIME_PERSONA;
  const selectedTtsVoice = normalizeTtsVoiceName(slimeDraft.voice?.preferredVoiceName) ?? '';

  useEffect(() => {
    const raw = slimeDraft.voice?.preferredVoiceName;
    const normalized = normalizeTtsVoiceName(raw);
    if (!raw || raw === normalized) return;
    setSlimeDraft((s) => ({
      ...s,
      voice: {
        enabled: s.voice?.enabled !== false,
        rate: s.voice?.rate ?? 1,
        pitch: s.voice?.pitch ?? 1,
        preferredVoiceName: normalized,
      },
    }));
  }, [setSlimeDraft, slimeDraft.voice?.preferredVoiceName]);

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
      const r = await apiFetch('/api/profile/slime-persona/preview', {
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
          ...(previewModelOptionId ? { model_option_id: previewModelOptionId } : {}),
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
            <BuddyTooltip
              key={preset.id}
              content={`Apply the “${preset.label}” quick look — bundled colors, personality, shape, and motion.`}
            >
              <button
                type="button"
                onClick={() => setSlimeDraft((s) => ({ ...s, ...preset.patch }))}
                className="rounded-full border border-violet-200/70 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-violet-950 hover:border-violet-400"
              >
                {preset.label}
              </button>
            </BuddyTooltip>
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
        {slimeDraft.slimeSelfModel && slimeDraft.slimeSelfModel.nameSafeForUi === false ? (
          <p className="mt-1.5 text-[11px] leading-snug text-amber-800">
            Your saved slime name isn&apos;t safe to display out loud — pick a friendlier name above, or save to reset to
            Mochi.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-violet-200/60 bg-white/75 px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">Who is your Slime?</p>
        <p className="mt-2 text-xs leading-relaxed text-gray-700">
          I am a Slime Buddy: a small companion agent that helps you remember, decide, plan, and act. I am not you. I use
          your memory to help you, but your memory remains yours.
        </p>
        <dl className="mt-3 space-y-2 text-[11px] text-gray-800">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="shrink-0 font-medium text-violet-900">Slime name</dt>
            <dd className="min-w-0">{slimeDraft.slimeSelfModel?.spokenName || slimeDraft.name || '—'}</dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="shrink-0 font-medium text-violet-900">Slime role</dt>
            <dd className="min-w-0">Personal companion agent</dd>
          </div>
          <div>
            <dt className="font-medium text-violet-900">Relationship to you</dt>
            <dd className="mt-1">
              <select
                id={`${idPrefix}-relationship`}
                className={cn(fieldSelectClass, 'mt-0.5 max-w-full')}
                value={persona.companionRelationship ?? 'helper_pet_companion'}
                onChange={(e) =>
                  setPersona({
                    companionRelationship: e.target.value as SlimeCompanionRelationship,
                  })
                }
              >
                {RELATIONSHIP_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-800">Theme</p>
        <div className="mt-1.5 flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
          {COLOR_OPTIONS.map((o) => (
            <BuddyTooltip key={o.id} content={`Use the ${o.label} palette for your slime in chat and on the buddy screen.`}>
              <button
                type="button"
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
            </BuddyTooltip>
          ))}
        </div>
      </div>

      {slimeDraft.colorTheme === 'custom' ? (
        <div className="mt-2 flex flex-wrap items-end gap-4">
          {(
            [
              { key: 'primary' as const, label: 'Body', aria: 'Primary body color' },
              { key: 'secondary' as const, label: 'Mid', aria: 'Secondary mid-tone' },
              { key: 'glow' as const, label: 'Glow', aria: 'Glow accent' },
            ] as const
          ).map(({ key, label, aria }) => {
            const fallback = DEFAULT_CUSTOM_COLORS[key];
            const current = slimeDraft.customColors?.[key] ?? fallback;
            const safe = hexForColorInput(current, fallback);
            return (
              <div key={key} className="flex flex-col items-center gap-1">
                <label className="relative block h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-white shadow-sm ring-1 ring-violet-300/60 transition hover:ring-violet-400">
                  <span className="pointer-events-none absolute inset-0 rounded-full" style={{ backgroundColor: safe }} />
                  <input
                    type="color"
                    value={safe}
                    aria-label={aria}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSlimeDraft((s) => ({
                        ...s,
                        customColors: {
                          primary: hexForColorInput(s.customColors?.primary, DEFAULT_CUSTOM_COLORS.primary),
                          secondary: hexForColorInput(s.customColors?.secondary, DEFAULT_CUSTOM_COLORS.secondary),
                          glow: hexForColorInput(s.customColors?.glow, DEFAULT_CUSTOM_COLORS.glow),
                          [key]: v,
                        },
                      }));
                    }}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
                <span className="text-[10px] font-medium text-gray-600">{label}</span>
              </div>
            );
          })}
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
              <BuddyTooltip
                key={pr.id}
                content={`Apply the “${pr.label}” persona preset — baseline tone, warmth, humor, directness, and reply length.`}
              >
                <button
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
              </BuddyTooltip>
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
              <BuddyTooltip
                key={id}
                content={`Prefer ${label.toLowerCase()} replies when your Slime speaks (length hint for the model).`}
              >
                <button
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
              </BuddyTooltip>
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

        <div className="mt-3 space-y-2 rounded-lg border border-violet-100/90 bg-white/70 p-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
            <div className="min-w-0 flex-1 sm:min-w-[12rem] sm:max-w-md">
              <ModelSelector
                feature="shadow_chat"
                selectedModelId={previewModelOptionId || slimeModels.defaultModel}
                onChange={setPreviewModelOptionId}
                models={slimeModels.models}
                selectorEnabled={slimeModels.selectorEnabled}
                showCostPreview
                variant="compact"
                elevated={false}
                hideCompactHeader
                compactSelectAriaLabel="Model for preview line"
                hint=""
                disabled={previewBusy}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Label className="sr-only" htmlFor="slime-preview-ctx">
                Preview scenario
              </Label>
              <select
                id="slime-preview-ctx"
                value={previewCtx}
                onChange={(e) => setPreviewCtx(e.target.value as typeof previewCtx)}
                className={cn(fieldSelectClass, 'h-8 min-w-[10rem] max-w-full flex-1 text-[11px] sm:max-w-[220px]')}
              >
                <option value="casual">Casual recommendation</option>
                <option value="memory">Memory answer</option>
                <option value="calendar">Calendar</option>
                <option value="decision">Decision mode</option>
              </select>
              <BuddyTooltip content="Ask the server for one sample line using your persona and the selected scenario (uses your chosen model tier).">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={previewBusy}
                  onClick={() => void runPreview()}
                  className="h-8 shrink-0 rounded-full text-[11px]"
                >
                  {previewBusy ? '…' : 'Preview'}
                </Button>
              </BuddyTooltip>
            </div>
          </div>
          {previewLine !== null ? (
            <p className="text-xs italic leading-relaxed text-gray-800">
              <span className="font-semibold not-italic text-violet-800">{slimeDraft.name}:</span> {previewLine}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-violet-100/80 bg-white/60 p-2.5">
        <p className="text-[11px] font-medium text-gray-800">TTS voice (Buddy + reports)</p>
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
        <select
          value={selectedTtsVoice}
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
          <option value="">Server default</option>
          {OPENAI_TTS_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <BuddyTooltip content="Persist appearance, persona, and voice settings to your profile on the server.">
          <Button
            type="button"
            size="sm"
            onClick={() => void onSave()}
            className="rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-xs font-semibold text-white shadow-sm"
          >
            Save slime
          </Button>
        </BuddyTooltip>
        <BuddyTooltip content="Restore the default Slime preset from the server (discards unsaved local edits after reload).">
          <Button type="button" variant="outline" size="sm" onClick={() => void onReset()} className="rounded-full text-xs">
            Reset
          </Button>
        </BuddyTooltip>
      </div>
    </div>
  );
}
