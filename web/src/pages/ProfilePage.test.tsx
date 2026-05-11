import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import ProfilePage from './ProfilePage';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'test' } },
    signOut: vi.fn(),
  }),
  isSupabaseEnvConfigured: () => false,
}));

vi.mock('../app/components/credits/SlimeCreditsContext', () => ({
  useSlimeCredits: () => ({
    credits: {
      balance: 10,
      lifetime_granted: 10,
      lifetime_used: 0,
      limits_enabled: true,
      is_admin: false,
      is_unlimited: false,
      display_balance: 10,
    },
    loading: false,
    refresh: vi.fn(),
    showInsufficient: vi.fn(),
  }),
  SlimeCreditsChipNav: () => null,
  SlimeCreditsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../app/components/PageBackButton', () => ({
  PageBackButton: () => <div data-testid="page-back-stub" />,
}));

vi.mock('../features/models/useSlimeModelCatalog', () => ({
  useSlimeModelCatalog: () => ({
    models: [
      {
        id: 'little',
        display_name: 'Little Slime',
        description: 'Test',
        best_for: [],
        tier: 'lite',
        speed: 'fast',
        quality: 'basic',
        credit_multiplier: 0.35,
        enabled: true,
        engine: 'gpt-4o-mini',
      },
    ],
    defaultModel: 'little',
    selectorEnabled: true,
    loading: false,
    error: null,
    refresh: vi.fn(),
    ready: true,
  }),
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
  it('renders priorities and credits sections without slime form', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );
    expect(html).toContain('Slime Credits');
    expect(html).toContain('gpt-4o-mini');
    expect(html).toContain('Your priorities');
    expect(html).not.toContain('Quick presets');
    expect(html).not.toContain('data-testid="slime-advisor"');
  });
});
