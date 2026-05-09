import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentPresence3DPanel, buildActivitySteps } from './AgentPresence3DPanel';

describe('AgentPresence3DPanel', () => {
  it('renders without crashing', () => {
    const html = renderToStaticMarkup(
      <AgentPresence3DPanel status="idle" timeline={['Ready']} forceFallback />,
    );
    expect(html).toContain('Shadow Chat');
  });

  it('exposes thinking status for accessibility', () => {
    const html = renderToStaticMarkup(
      <AgentPresence3DPanel status="thinking" timeline={['Thinking']} forceFallback />,
    );
    expect(html).toContain('data-agent-status="thinking"');
    expect(html).toContain('Thinking it through');
  });

  it('exposes reading_memory status', () => {
    const html = renderToStaticMarkup(
      <AgentPresence3DPanel status="reading_memory" timeline={['Reading memory']} forceFallback />,
    );
    expect(html).toContain('data-agent-status="reading_memory"');
    expect(html).toContain('Gathering context');
  });

  it('renders fallback orb UI when fallback is forced', () => {
    const html = renderToStaticMarkup(
      <AgentPresence3DPanel status="responding" timeline={['Responding']} forceFallback />,
    );
    expect(html).toContain('data-agent-status="responding"');
    expect(html).toContain('Writing a reply');
  });

  it('shows report overlay session card while overlay is open', () => {
    const html = renderToStaticMarkup(
      <AgentPresence3DPanel
        status="report_generating"
        timeline={['Generating report']}
        forceFallback
        reportOverlaySession={{ streaming: true, progressStep: 'Evaluating trade-offs' }}
      />,
    );
    expect(html).toContain('Report generating');
    expect(html).toContain('Evaluating trade-offs');
  });

  it('keeps decision report CTA when status returns to idle but suggestion is still active', () => {
    const html = renderToStaticMarkup(
      <AgentPresence3DPanel
        status="idle"
        timeline={['Ready']}
        forceFallback
        suggestion={{ type: 'decision_report', title: 'Turn this into a decision report?', message: 'Structured options and trade-offs.' }}
        onGenerateReport={() => {}}
      />,
    );
    expect(html).toContain('data-agent-status="idle"');
    expect(html).toContain('Generate report');
    expect(html).toContain('Decision detected');
  });

  it('keeps status flow progression for chat steps', () => {
    const steps = buildActivitySteps('responding');
    expect(steps[1].state).toBe('done');
    expect(steps[3].state).toBe('active');
  });
});
