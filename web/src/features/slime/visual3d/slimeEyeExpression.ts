import type { SlimeAdvisorState } from '../../../app/components/report/slimeAdvisorTypes';

export type EyeExpression = 'happy' | 'curious' | 'sleepy' | 'surprised' | 'cautious';

export function eyeExpressionFromState(state: SlimeAdvisorState): EyeExpression {
  switch (state) {
    case 'listening':
      return 'curious';
    case 'thinking':
    case 'remembering':
    case 'preparing':
      return 'curious';
    case 'speaking':
      return 'happy';
    case 'cautious':
      return 'cautious';
    case 'celebrating':
      return 'surprised';
    default:
      return 'happy';
  }
}

export type EyeExpressionParams = {
  eyeScale: number;
  lidClose: number;
  browLift: number;
  pupilScale: number;
  eyeOpen: number;
};

export function eyeParamsForExpression(expr: EyeExpression, listen = 0): EyeExpressionParams {
  switch (expr) {
    case 'curious':
      return {
        eyeScale: 1.06 + listen * 0.04,
        lidClose: -0.05,
        browLift: 0.08,
        pupilScale: 0.95,
        eyeOpen: 1.05,
      };
    case 'sleepy':
      return { eyeScale: 1, lidClose: 0.42, browLift: 0, pupilScale: 0.88, eyeOpen: 0.85 };
    case 'surprised':
      return { eyeScale: 1.1, lidClose: -0.08, browLift: 0.12, pupilScale: 0.82, eyeOpen: 1.12 };
    case 'cautious':
      return { eyeScale: 0.96, lidClose: 0.06, browLift: -0.04, pupilScale: 0.92, eyeOpen: 0.95 };
    case 'happy':
    default:
      return {
        eyeScale: 1,
        lidClose: -0.02,
        browLift: 0.02,
        pupilScale: 0.92,
        eyeOpen: 1,
      };
  }
}
