import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RimumuIntroductionTrigger } from './RimumuIntroductionDialog';

describe('RimumuIntroductionDialog', () => {
  it('renders introduction trigger with Chinese label', () => {
    const html = renderToStaticMarkup(<RimumuIntroductionTrigger onClick={() => {}} />);
    expect(html).toContain('data-testid="rimumu-introduction-trigger"');
    expect(html).toContain('About Rimumu');
  });
});
