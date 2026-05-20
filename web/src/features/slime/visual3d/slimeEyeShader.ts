import * as THREE from 'three';
import type { MascotFaceColors } from './mascotPalette';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Chibi round eyes — big iris, small pupil, soft highlights. */
const fragmentShader = /* glsl */ `
  uniform vec3 uIris;
  uniform vec3 uIrisDeep;
  uniform vec3 uPupil;
  uniform vec3 uSclera;
  uniform float uLidClose;
  uniform float uPupilScale;
  uniform float uEyeOpen;
  varying vec2 vUv;

  float highlight(vec2 uv, vec2 center, float size) {
    return 1.0 - smoothstep(0.0, size, length(uv - center));
  }

  void main() {
    vec2 uv = (vUv - 0.5) * vec2(0.88, 1.05);
    float dist = length(uv);

    float edge = 1.0 - smoothstep(0.9, 1.0, dist);
    if (edge < 0.01) discard;

    vec3 col = uSclera;

    float irisR = 0.88 * uPupilScale * uEyeOpen;
    float irisMask = 1.0 - smoothstep(irisR - 0.02, irisR + 0.01, dist);
    vec3 irisCol = mix(uIrisDeep, uIris, 1.0 - dist / max(irisR, 0.01));
    col = mix(col, irisCol, irisMask);

    float pupilR = 0.2 * uPupilScale;
    float pupilMask = 1.0 - smoothstep(pupilR - 0.02, pupilR + 0.02, dist);
    col = mix(col, uPupil, pupilMask);

    col += vec3(1.0) * highlight(uv, vec2(0.22, 0.28), 0.14) * 1.0;
    col += vec3(1.0) * highlight(uv, vec2(-0.18, 0.2), 0.08) * 0.75;
    col += vec3(1.0) * highlight(uv, vec2(0.06, 0.36), 0.05) * 0.55;

    float lidLine = uv.y + 0.08;
    float lid = 1.0 - smoothstep(uLidClose, uLidClose + 0.1, lidLine);
    col *= lid;
    gl_FragColor = vec4(col, edge * lid);
  }
`;

export function createSlimeEyeMaterial(face: MascotFaceColors): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uIris: { value: face.iris.clone() },
      uIrisDeep: { value: face.irisDeep.clone() },
      uPupil: { value: face.pupil.clone() },
      uSclera: { value: face.sclera.clone() },
      uLidClose: { value: 0 },
      uPupilScale: { value: 1 },
      uEyeOpen: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
}
