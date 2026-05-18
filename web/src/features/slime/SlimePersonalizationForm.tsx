import type { SlimeType } from './slimeIdentity';
import { SlimeIdentityPanel } from './SlimeIdentityPanel';
import { SlimeModeSwitcher } from './SlimeModeSwitcher';

/** Former personalization sheet — identity + switch Mochi / Rimumu in About only. */
export function SlimePersonalizationForm({
  slimeType = 'generalized',
  onSlimeTypeChange,
}: {
  slimeType?: SlimeType;
  onSlimeTypeChange?: (next: SlimeType) => void;
  slimeDraft?: unknown;
  setSlimeDraft?: unknown;
  onSave?: () => void | Promise<void>;
  onReset?: () => void | Promise<void>;
  idPrefix?: string;
}) {
  return (
    <div className="space-y-4">
      {onSlimeTypeChange ? (
        <SlimeModeSwitcher value={slimeType} onChange={onSlimeTypeChange} />
      ) : null}
      <SlimeIdentityPanel slimeType={slimeType} />
    </div>
  );
}
