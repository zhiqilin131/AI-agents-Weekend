import type { PersonalProfile } from './onboarding';

export type UserProfile = {
  user_priorities?: string[];
  priorities?: string[];
  inferred_priorities?: string[];
  priority_lines?: Array<{
    id?: string;
    text: string;
    origin: 'user' | 'system';
    channel?: string;
    created_at?: string;
  }>;
  about_me?: string;
  constraints?: string[];
  values?: string[];
  timezone?: string;
  default_model_option_id?: string;
  personal_profile?: PersonalProfile;
  [key: string]: unknown;
};
