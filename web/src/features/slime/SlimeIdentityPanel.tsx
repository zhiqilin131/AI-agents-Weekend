import { getSlimeIdentity, type SlimeType } from './slimeIdentity';

/** Read-only Slime identity — appearance and voice are fixed per type. */
export function SlimeIdentityPanel({ slimeType }: { slimeType: SlimeType }) {
  const ident = getSlimeIdentity(slimeType);
  return (
    <div className="min-w-0 space-y-3 pb-4">
      <div
        className="rounded-xl border px-3 py-3"
        style={{
          borderColor: ident.theme.border,
          background: `linear-gradient(145deg, ${ident.theme.surface} 0%, ${ident.theme.background} 100%)`,
        }}
      >
        <p
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: ident.theme.heading }}
        >
          {ident.displayName}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-gray-800">{ident.tagline}</p>
        <p className="mt-3 text-xs leading-relaxed text-gray-700">{ident.personaSelfIntro}</p>
        <p className="mt-2 text-[11px] text-gray-600">
          Traits: {ident.personaTraits.join(' · ')}. Color, voice, and speaking style are fixed — switch
          companions above or double-click the slime on the Buddy screen.
        </p>
      </div>
    </div>
  );
}
