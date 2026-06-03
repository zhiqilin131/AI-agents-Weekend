import { describe, expect, it } from 'vitest';
import { humanizeTagConflict, tagQualityNotices } from './featureAudit';

describe('featureAudit helpers', () => {
  it('humanizes backend conflict strings', () => {
    expect(
      humanizeTagConflict(
        'stress_load_level=low conflicts with high-stress language in option text',
      ),
    ).toBe('Stress tagged low · high stress language');
  });

  it('collects tag quality notices only when issues exist', () => {
    const notices = tagQualityNotices({
      tag_quality_reports: [
        {
          option_id: 'stay',
          passes_quality_gate: true,
          text_conflicts: [],
        },
        {
          option_id: 'quit',
          passes_quality_gate: false,
          text_conflicts: ['stress_load_level=low conflicts with high-stress language in option text'],
        },
      ],
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.optionId).toBe('quit');
    expect(notices[0]?.conflicts[0]).toContain('Stress tagged low');
  });

  it('includes gate failures without text conflicts', () => {
    const notices = tagQualityNotices({
      tag_quality_reports: [{ option_id: 'a', passes_quality_gate: false, text_conflicts: [] }],
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.gateFailed).toBe(true);
  });
});
