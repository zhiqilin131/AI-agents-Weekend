import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../app/components/ui/dialog';
import { getSlimeIdentity, SLIME_TYPE_ORDER, type SlimeType } from './slimeIdentity';

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (slimeType: SlimeType) => void;
};

export function PickSlimeForNewChatDialog({ open, onClose, onPick }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg border-violet-100 bg-gradient-to-b from-white to-violet-50/40">
        <DialogHeader>
          <DialogTitle className="text-violet-950">Choose your Slime</DialogTitle>
          <DialogDescription className="text-violet-900/70">
            Each chat is tied to one companion for its whole life — pick who you want for this thread.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {SLIME_TYPE_ORDER.map((type) => {
            const ident = getSlimeIdentity(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => onPick(type)}
                className="rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                style={{
                  borderColor: ident.theme.border,
                  background: `linear-gradient(145deg, ${ident.theme.surface} 0%, ${ident.theme.background} 100%)`,
                }}
              >
                <p
                  className="text-sm font-bold uppercase tracking-wide"
                  style={{ color: ident.theme.heading }}
                >
                  {ident.displayName}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-gray-700">{ident.tagline}</p>
                {type === 'wellbeing' ? (
                  <p className="mt-2 text-[10px] font-medium text-rose-800/80">
                    Therapy sessions · check-in · session report
                  </p>
                ) : (
                  <p className="mt-2 text-[10px] font-medium text-indigo-800/80">
                    Plans · decisions · everyday chat
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
