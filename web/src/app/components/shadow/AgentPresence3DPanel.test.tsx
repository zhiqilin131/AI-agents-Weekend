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

  it('shows Thinking label when mode is thinking', () => {
    const html = renderToStaticMarkup(
      <AgentPresence3DPanel status="thinking" timeline={['Thinking']} forceFallback />,
    );
    expect(html).toContain('Thinking');
  });

  it('shows Reading memory label when mode is reading_memory', () => {
    const html = renderToStaticMarkup(
      <AgentPresence3DPanel status="reading_memory" timeline={['Reading memory']} forceFallback />,
    );
    expect(html).toContain('Reading memory');
  });

  it('renders fallback orb UI when fallback is forced', () => {
    const html = renderToStaticMarkup(
      <AgentPresence3DPanel status="responding" timeline={['Responding']} forceFallback />,
    );
    expect(html).toContain('Current');
    expect(html).toContain('Responding');
  });

  it('keeps status flow progression for chat steps', () => {
    const steps = buildActivitySteps('responding');
    expect(steps[1].state).toBe('done');
    expect(steps[3].state).toBe('active');
  });
});
