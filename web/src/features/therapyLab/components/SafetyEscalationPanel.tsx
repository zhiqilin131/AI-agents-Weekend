import { Phone } from 'lucide-react';
import { SAFETY_ESCALATION_REPLY } from '../safetyEscalation';
import { TherapyLabPanel, TherapyLabPrimaryButton } from './TherapyLabChrome';

export function SafetyEscalationPanel({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <TherapyLabPanel className="border-rose-200/80 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Safety pause</p>
      <p className="mt-3 text-sm leading-relaxed text-slate-800">{SAFETY_ESCALATION_REPLY}</p>
      <p className="mt-3 text-xs leading-relaxed text-slate-600">
        This lab is emotional support, not emergency care or medical treatment. If you can, contact local
        emergency services or a crisis line (U.S. 988).
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href="tel:988"
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900"
        >
          <Phone className="h-4 w-4" aria-hidden />
          U.S. 988
        </a>
        <TherapyLabPrimaryButton onClick={onAcknowledge}>I understand — return to lab menu</TherapyLabPrimaryButton>
      </div>
    </TherapyLabPanel>
  );
}
