import type { ReactNode } from 'react';
import { BookOpen, Brain, HeartHandshake, Shield, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../app/components/ui/dialog';
import { cn } from '../../app/components/ui/utils';
import { getSlimeIdentity } from './slimeIdentity';

const PROTOCOL_PILLARS = [
  { abbr: 'CBT', name: 'Cognitive Behavioral Therapy', focus: 'Thoughts, beliefs, and behavioral experiments' },
  { abbr: 'DBT', name: 'Dialectical Behavior Therapy', focus: 'Emotion regulation & distress tolerance' },
  { abbr: 'ACT', name: 'Acceptance & Commitment', focus: 'Values, willingness, and committed action' },
  { abbr: 'BA', name: 'Behavioral Activation', focus: 'Mood–activity cycles and small steps' },
  { abbr: 'MI', name: 'Motivational Interviewing', focus: 'Ambivalence and change talk' },
  { abbr: 'IPT', name: 'Interpersonal Therapy', focus: 'Relationships, roles, and communication' },
  { abbr: 'PM+', name: 'Problem Management Plus', focus: 'Structured problem-solving (WHO-informed)' },
] as const;

const SESSION_FLOW = [
  { label: 'You speak', sub: 'Voice or chat' },
  { label: 'Safety check', sub: 'Crisis-aware' },
  { label: 'Protocol match', sub: 'CBT · DBT · ACT…' },
  { label: 'One move / turn', sub: 'Alliance-first' },
  { label: 'Session report', sub: 'Themes & next steps' },
  { label: 'Wellbeing memory', sub: 'Next time' },
] as const;

const TRIAGE_FLOW = [
  { label: 'Distress level', sub: '0–10 scale' },
  { label: 'Situation + goal', sub: 'Check-in' },
  { label: 'Theory fit', sub: 'Evidence catalog' },
  { label: 'Guided technique', sub: 'Not diagnosis' },
] as const;

const CAPABILITIES = [
  '30-second check-in — mood, concern, and session goal (not a diagnosis)',
  'Evidence-informed techniques chosen for what you say right now',
  'Structured therapy sessions with a closing report you can revisit',
  'Wellbeing memory separate from general profile — continuity across sessions',
  'Voice-first buddy plus full Chat handoff when you want a longer thread',
  'Crisis-aware routing — slows down and points to real-world help when needed',
] as const;

type FlowNode = { label: string; sub?: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function FlowArrow({ vertical }: { vertical?: boolean }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center text-rose-500',
        vertical ? 'h-6 w-full' : 'hidden h-auto w-8 sm:flex',
      )}
      aria-hidden
    >
      {vertical ? (
        <svg viewBox="0 0 12 20" className="h-4 w-3" fill="currentColor">
          <path d="M6 16 1 9h3V0h4v9h3L6 16z" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 12" className="h-3.5 w-5" fill="currentColor">
          <path d="M16 6 9 1v3H0v4h9v3l7-6z" />
        </svg>
      )}
    </span>
  );
}

function FlowNodeBox({ label, sub }: FlowNode) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-rose-200/90 bg-white px-3 py-2.5 text-center shadow-sm">
      <p className="text-xs font-semibold leading-snug text-slate-900 sm:text-sm">{label}</p>
      {sub ? <p className="mt-1 text-[11px] leading-snug text-slate-600 sm:text-xs">{sub}</p> : null}
    </div>
  );
}

function FlowChart({
  nodes,
  vertical,
}: {
  nodes: readonly FlowNode[];
  vertical?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex gap-0',
        vertical ? 'flex-col items-stretch' : 'flex-col items-stretch sm:flex-row sm:flex-wrap sm:items-center',
      )}
    >
      {nodes.map((node, i) => (
        <div
          key={node.label}
          className={cn('flex items-center', vertical ? 'flex-col' : 'flex-col sm:flex-row')}
        >
          {i > 0 ? <FlowArrow vertical={vertical} /> : null}
          <FlowNodeBox label={node.label} sub={node.sub} />
        </div>
      ))}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Brain;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2.5 text-lg font-semibold text-slate-900">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 shadow-sm">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function IntroBody() {
  const ident = getSlimeIdentity('wellbeing');
  return (
    <div className="space-y-8 pb-2">
      <Section icon={Brain} title="Psychology × AI — how we work">
        <p className="text-sm leading-relaxed text-slate-700 sm:text-[15px] sm:leading-relaxed">
          {ident.displayName} is built on an <strong className="font-semibold text-slate-900">evidence-informed protocol library</strong>
          — not a single generic prompt. Each turn, she listens for distress level, situation, and your goal,
          then routes to a <strong className="font-semibold text-slate-900">named therapeutic frame</strong> (CBT, DBT, ACT, and
          others) with one structured move at a time — the way a skilled supporter would, not a lecture.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {PROTOCOL_PILLARS.map((p) => (
            <div
              key={p.abbr}
              className="rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-3"
            >
              <p className="text-xs font-bold tracking-wide text-rose-700">{p.abbr}</p>
              <p className="mt-1 text-sm font-semibold leading-snug text-slate-900">{p.name}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{p.focus}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={Sparkles} title="Session journey">
        <p className="text-sm text-slate-600">From first word to memory that carries forward:</p>
        <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
          <FlowChart nodes={SESSION_FLOW} />
        </div>
      </Section>

      <Section icon={HeartHandshake} title="Per-turn triage">
        <p className="text-sm text-slate-600">How each message is matched to technique:</p>
        <div className="mt-3 rounded-2xl border border-rose-100 bg-white p-4">
          <FlowChart nodes={TRIAGE_FLOW} vertical />
        </div>
      </Section>

      <Section icon={Shield} title="What she can do for you">
        <ul className="space-y-2.5">
          {CAPABILITIES.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-slate-700 sm:text-[15px]">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export function RimumuIntroductionDialog({ open, onOpenChange }: Props) {
  const ident = getSlimeIdentity('wellbeing');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="rimumu-introduction-dialog"
        overlayClassName="z-[200] bg-slate-950/65 backdrop-blur-[3px]"
        className={cn(
          '!flex z-[201] max-h-[min(94dvh,880px)] w-[min(calc(100vw-1.25rem),44rem)] max-w-[calc(100%-1.25rem)] flex-col gap-0 overflow-hidden',
          'rounded-2xl border border-rose-200/90 bg-white p-0 shadow-2xl sm:max-w-2xl lg:max-w-3xl',
        )}
      >
        <DialogHeader className="shrink-0 space-y-2 border-b border-rose-100 px-6 pb-4 pt-6 text-left sm:px-8">
          <DialogTitle className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            About {ident.displayName}
          </DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-slate-600">
            {ident.tagline}
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="rimumu-introduction-scroll"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 sm:px-8"
        >
          <IntroBody />
        </div>

        <p className="shrink-0 border-t border-rose-100 bg-rose-50/50 px-6 py-4 text-sm leading-relaxed text-slate-600 sm:px-8">
          {ident.shortName} supports reflection and coping skills — not diagnosis, medication, or emergency
          care. If you are in immediate danger, contact local emergency services or crisis lines (e.g. 988 in
          the U.S.).
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function RimumuIntroductionTrigger({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const ident = getSlimeIdentity('wellbeing');
  return (
    <button
      type="button"
      data-testid="rimumu-introduction-trigger"
      onClick={onClick}
      aria-label={`About ${ident.displayName}`}
      className={cn(
        'inline-flex max-w-[min(100vw-5rem,220px)] items-center gap-2 rounded-full border border-rose-200/90 bg-white/90 px-3.5 py-2 text-xs font-semibold text-slate-900 shadow-sm backdrop-blur-md transition hover:border-rose-400/90 hover:bg-white sm:text-sm',
        className,
      )}
    >
      <BookOpen className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden />
      <span className="truncate">About {ident.displayName}</span>
    </button>
  );
}
