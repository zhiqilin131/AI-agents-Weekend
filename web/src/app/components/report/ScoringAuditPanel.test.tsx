import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoringAuditPanel } from './ScoringAuditPanel';

describe('ScoringAuditPanel', () => {
  it('renders tag mismatch summary when conflicts exist', () => {
    const html = renderToStaticMarkup(
      <ScoringAuditPanel
        audit={{
          grounded_feature_coverage: 0.42,
          feature_vectors: [
            {
              option_id: 'quit',
              field_status: { stress_load_level: 'candidate' },
            },
          ],
          tag_quality_reports: [
            {
              option_id: 'quit',
              passes_quality_gate: false,
              text_conflicts: ['stress_load_level=low conflicts with high-stress language in option text'],
            },
          ],
        }}
      />,
    );
    expect(html).toContain('data-testid="scoring-audit-panel"');
    expect(html).toContain('label mismatch');
    expect(html).toContain('42% grounded');
  });

  it('omits tag hints when all reports pass', () => {
    const html = renderToStaticMarkup(
      <ScoringAuditPanel
        audit={{
          feature_vectors: [{ option_id: 'a', field_status: { stress_load_level: 'known' } }],
          tag_quality_reports: [{ option_id: 'a', passes_quality_gate: true, text_conflicts: [] }],
        }}
      />,
    );
    expect(html).not.toContain('label mismatch');
  });
});
