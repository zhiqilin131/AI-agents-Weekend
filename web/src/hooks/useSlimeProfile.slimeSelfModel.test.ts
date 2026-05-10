import { describe, expect, it } from 'vitest';
import { normalizeSlimeSelfModel } from './useSlimeProfile';

describe('normalizeSlimeSelfModel', () => {
  it('maps snake_case API payload', () => {
    const v = normalizeSlimeSelfModel({
      name: 'Mochi',
      name_safe_for_ui: true,
      spoken_name: 'Mochi',
      relationship_to_user: 'helper_pet_companion',
      abilities: ['chat'],
      limitations: ['no bypass'],
      boundaries: ['User memory describes the user'],
    });
    expect(v?.nameSafeForUi).toBe(true);
    expect(v?.spokenName).toBe('Mochi');
    expect(v?.relationshipToUser).toBe('helper_pet_companion');
    expect(v?.abilities).toEqual(['chat']);
  });

  it('returns null for invalid input', () => {
    expect(normalizeSlimeSelfModel(null)).toBeNull();
    expect(normalizeSlimeSelfModel('x')).toBeNull();
  });
});
