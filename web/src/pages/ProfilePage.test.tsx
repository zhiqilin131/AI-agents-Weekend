import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import ProfilePage from './ProfilePage';

vi.mock('../app/components/PageBackButton', () => ({
  PageBackButton: () => <div data-testid="page-back-stub" />,
}));

vi.mock('../hooks/useSlimeProfile', () => ({
  DEFAULT_SLIME_PROFILE: {
    name: 'Mochi',
    colorTheme: 'violet',
    personality: 'calm',
    shape: 'classic',
    accessory: 'none',
    motion: 'normal',
    updated_at: '',
  },
  useSlimeProfile: () => ({
    slimeProfile: {
      name: 'Mochi',
      colorTheme: 'violet',
      personality: 'calm',
      shape: 'classic',
      accessory: 'none',
      motion: 'normal',
      updated_at: '',
    },
    isLoading: false,
    error: null,
    updateSlimeProfile: vi.fn(),
    resetSlimeProfile: vi.fn(),
    refreshSlimeProfile: vi.fn(),
  }),
}));

describe('ProfilePage', () => {
  it('renders priorities and Buddy home link without slime form', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );
    expect(html).toContain('Buddy home');
    expect(html).toContain('Your priorities');
    expect(html).not.toContain('Quick presets');
    expect(html).not.toContain('data-testid="slime-advisor"');
  });
});
