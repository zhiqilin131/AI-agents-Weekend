import type { SlimeAdvisorState } from '../../../app/components/report/slimeAdvisorTypes';
import type { SlimeProfile } from '../../../app/model';
import type { SlimeType } from '../slimeIdentity';
import { slimeBreathPeriod } from './slimeVisualTokens';

/** Numeric state for shader uStateIndex */
export const SLIME_STATE_INDEX: Record<SlimeAdvisorState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  remembering: 3,
  preparing: 4,
  speaking: 5,
  cautious: 6,
  celebrating: 7,
};

export type SlimeMotionUniforms = {
  stateIndex: number;
  squashY: number;
  squashX: number;
  pulse: number;
  rimBoost: number;
  speak: number;
  listen: number;
  think: number;
  blinkPhase: number;
  eyeScale: number;
  mouthOpen: number;
  wobble: number;
  vertexWobble: number;
};

export function slimeMotionUniforms(
  state: SlimeAdvisorState,
  slimeType: SlimeType,
  profile: SlimeProfile,
  time: number,
  speakAmplitude = 0,
): SlimeMotionUniforms {
  const isSpeaking = state === 'speaking';
  const isListening = state === 'listening';
  const isThinking =
    state === 'thinking' || state === 'remembering' || state === 'preparing';
  const isCelebrating = state === 'celebrating';
  const isCautious = state === 'cautious';
  const wellbeing = slimeType === 'wellbeing';
  const breath = slimeBreathPeriod(slimeType, profile);
  const breathWave = Math.sin(time * ((Math.PI * 2) / breath));

  const motionScale =
    profile.motion === 'subtle' ? 0.78 : profile.motion === 'expressive' ? 1.15 : 1;
  const personalityFloat =
    profile.personality === 'playful'
      ? 1.05
      : profile.personality === 'direct'
        ? 0.85
        : profile.personality === 'calm'
          ? 0.9
          : 1;

  const breathAmp = wellbeing ? 0.02 : 0.035;
  let squashY = 1 + breathWave * breathAmp * motionScale * personalityFloat;
  let squashX = 1 - breathWave * (breathAmp * 0.75) * motionScale;
  let pulse = 0.32 + breathWave * 0.12;
  let rimBoost = wellbeing ? 0.5 : 0.62;
  let speak = 0;
  let listen = 0;
  let think = 0;
  let mouthOpen = wellbeing ? 0.1 : 0.07;
  let wobble = 0;
  let vertexWobble = wellbeing ? 0.012 : 0.018;
  let eyeScale = 1;

  if (isSpeaking) {
    const amp = Math.min(0.92, speakAmplitude);
    speak = amp * 0.55;
    if (amp > 0.025) {
      mouthOpen = wellbeing ? 0.1 + amp * 0.78 : 0.12 + amp * 0.86;
    }
    squashY = 1 + Math.sin(time * 4) * 0.025 * motionScale;
    squashX = 1 + Math.cos(time * 3.5) * 0.02;
    pulse = 0.45 + amp * 0.15;
    rimBoost = 0.75;
    wobble = 0;
    vertexWobble = 0;
    eyeScale = 1;
  } else if (isListening) {
    listen = 0.75 + Math.sin(time * 3) * 0.12;
    squashY = 1 + Math.sin(time * 2.5) * 0.03;
    rimBoost = 0.68;
    eyeScale = 1.08 + listen * 0.04;
  } else if (isThinking) {
    think = 0.65 + Math.sin(time * 2) * 0.15;
    squashY = 1 + Math.sin(time * 1.6) * 0.04;
    wobble = wellbeing ? 0.01 : 0.02;
    vertexWobble = wobble;
  } else if (isCelebrating) {
    squashY = 1 + Math.sin(time * 5) * 0.06;
    squashX = 1 + Math.cos(time * 4.5) * 0.05;
    pulse = 0.7;
    rimBoost = 0.9;
    wobble = 0.04;
    vertexWobble = 0.03;
  } else if (isCautious) {
    squashY = 0.98 + breathWave * 0.015;
    rimBoost = 0.45;
    pulse = 0.35;
  }

  const blinkDuration =
    (profile.motion === 'subtle' ? 6.2 : profile.motion === 'expressive' ? 3.8 : 5) *
    (wellbeing ? 1.2 : 1) *
    (isThinking ? 1.42 : isListening ? 1.08 : isSpeaking ? 1.15 : 1);
  const blinkPhase = (time % blinkDuration) / blinkDuration;

  return {
    stateIndex: SLIME_STATE_INDEX[state],
    squashY,
    squashX,
    pulse,
    rimBoost,
    speak,
    listen,
    think,
    blinkPhase,
    eyeScale,
    mouthOpen: Math.min(mouthOpen, wellbeing ? 0.52 : 0.58),
    wobble,
    vertexWobble,
  };
}

/** Default mouth Y as fraction of container height (for comic bubble CSS). */
export function defaultMouthAnchorY(slimeType: SlimeType): string {
  return slimeType === 'wellbeing' ? '58%' : '56%';
}
