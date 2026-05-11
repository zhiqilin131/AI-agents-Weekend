import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../../../utils/apiFetch';
import { useAuth } from '../../../auth/AuthContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { SlimeCreditIcon } from './SlimeCreditIcon';
import { cn } from '../ui/utils';

export type CreditsPayload = {
  balance: number | null;
  lifetime_granted: number;
  lifetime_used: number;
  limits_enabled: boolean;
  is_admin: boolean;
  is_unlimited: boolean;
  display_balance: number | '∞';
};

export type InsufficientCreditsPayload = {
  required: number;
  balance: number | null;
  message: string;
  /** Optional UX hint, e.g. switching to a lower tier model. */
  cheaperHint?: string;
};

type Ctx = {
  credits: CreditsPayload | null;
  loading: boolean;
  refresh: () => Promise<void>;
  showInsufficient: (p: InsufficientCreditsPayload) => void;
};

const SlimeCreditsContext = createContext<Ctx | null>(null);

async function fetchCreditsJson(): Promise<CreditsPayload> {
  const res = await apiFetch('/api/usage/credits');
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as CreditsPayload;
}

export function SlimeCreditsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [credits, setCredits] = useState<CreditsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<InsufficientCreditsPayload | null>(null);
  const [voucher, setVoucher] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemErr, setRedeemErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetchCreditsJson();
      setCredits(j);
    } catch {
      setCredits(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, session?.user?.id]);

  const showInsufficient = useCallback((p: InsufficientCreditsPayload) => {
    setRedeemErr(null);
    setVoucher('');
    setModal(p);
  }, []);

  const value = useMemo(
    () => ({
      credits,
      loading,
      refresh,
      showInsufficient,
    }),
    [credits, loading, refresh, showInsufficient],
  );

  const onRedeemVoucher = async () => {
    const code = voucher.trim();
    if (!code) return;
    setRedeemBusy(true);
    setRedeemErr(null);
    try {
      const res = await apiFetch('/api/usage/redeem-voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !j.ok) {
        setRedeemErr(typeof j.message === 'string' ? j.message : 'Could not redeem voucher.');
        return;
      }
      await refresh();
      setModal(null);
    } catch {
      setRedeemErr('Network error — try again.');
    } finally {
      setRedeemBusy(false);
    }
  };

  const balLabel =
    modal?.balance === null || modal?.balance === undefined ? '—' : String(modal.balance);

  return (
    <SlimeCreditsContext.Provider value={value}>
      {children}
      <AlertDialog open={modal !== null} onOpenChange={(o) => !o && setModal(null)}>
        <AlertDialogContent className="border border-white/20 bg-white/75 shadow-2xl backdrop-blur-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <SlimeCreditIcon className="h-6 w-6" />
              Not enough Slime Credits
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              {modal?.message ||
                `You need more Slime Credits for this action.`}{' '}
              {modal ? (
                <span className="block pt-2 font-medium text-slate-800">
                  This action needs {modal.required} credits. You have {balLabel}.
                </span>
              ) : null}
              {modal?.cheaperHint ? (
                <span className="mt-2 block rounded-md border border-violet-100 bg-violet-50/80 px-2 py-1.5 text-xs text-violet-950">
                  {modal.cheaperHint}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 px-1 pb-1">
            <p className="text-xs text-slate-500">Have a voucher code?</p>
            <div className="flex gap-2">
              <Input
                value={voucher}
                onChange={(e) => setVoucher(e.target.value)}
                placeholder="Enter voucher code"
                className="h-9 bg-white/90"
                disabled={redeemBusy}
              />
              <Button type="button" size="sm" className="shrink-0" disabled={redeemBusy} onClick={() => void onRedeemVoucher()}>
                Redeem
              </Button>
            </div>
            {redeemErr ? <p className="text-xs text-rose-600">{redeemErr}</p> : null}
          </div>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="border-slate-200 bg-white/90">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-violet-600 hover:bg-violet-700"
              onClick={() => {
                setModal(null);
                navigate('/profile');
              }}
            >
              Go to Profile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SlimeCreditsContext.Provider>
  );
}

export function useSlimeCredits() {
  const ctx = useContext(SlimeCreditsContext);
  if (!ctx) {
    throw new Error('useSlimeCredits must be used within SlimeCreditsProvider');
  }
  return ctx;
}

export function useSlimeCreditsOptional() {
  return useContext(SlimeCreditsContext);
}

/** Compact chip for nav: safe when provider missing (returns null UI helpers). */
export function SlimeCreditsChipNav({ compact }: { compact?: boolean }) {
  const ctx = useSlimeCreditsOptional();
  const navigate = useNavigate();
  if (!ctx) return null;
  const { credits, loading } = ctx;
  if (!credits) {
    return (
      <button
        type="button"
        onClick={() => navigate('/profile')}
        disabled={loading}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-amber-200/90 bg-amber-50/90 px-2.5 py-1 text-xs font-semibold text-amber-950 shadow-sm backdrop-blur-sm transition hover:border-amber-300',
          compact && 'px-2 py-0.5 text-[11px]',
        )}
        title="Open Profile — if balance stays empty, set VITE_API_ORIGIN on Vercel to your Railway API URL"
        aria-label="Slime Credits status unavailable — open Profile"
      >
        <SlimeCreditIcon className="h-3.5 w-3.5" />
        <span>{loading ? '…' : '—'}</span>
      </button>
    );
  }
  if (credits.is_unlimited) {
    return (
      <button
        type="button"
        onClick={() => navigate('/profile')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-violet-200/90 bg-gradient-to-r from-violet-50/95 to-emerald-50/90 px-2.5 py-1 text-xs font-semibold text-violet-900 shadow-sm backdrop-blur-sm transition hover:border-violet-300',
          compact && 'px-2 py-0.5 text-[11px]',
        )}
        aria-label="Unlimited Slime Credits — open Profile"
      >
        <SlimeCreditIcon className="h-3.5 w-3.5" />
        <span>∞</span>
      </button>
    );
  }
  const bal = credits.balance ?? 0;
  const low = bal > 0 && bal <= 5;
  const out = bal <= 0;
  return (
    <button
      type="button"
      onClick={() => navigate('/profile')}
      disabled={loading}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm backdrop-blur-sm transition',
        compact && 'px-2 py-0.5 text-[11px]',
        out && 'border-rose-200 bg-rose-50/95 text-rose-900 hover:border-rose-300',
        low && !out && 'border-amber-200 bg-amber-50/95 text-amber-950 hover:border-amber-300',
        !low && !out && 'border-emerald-200/90 bg-white/90 text-emerald-950 hover:border-emerald-300',
      )}
      aria-label={`Slime Credits: ${bal}. Open Profile.`}
    >
      <SlimeCreditIcon className="h-3.5 w-3.5" />
      <span>{loading ? '…' : bal}</span>
      {low && !out ? <span className="sr-only">Low credits</span> : null}
      {out ? <span className="sr-only">Out of credits</span> : null}
    </button>
  );
}
