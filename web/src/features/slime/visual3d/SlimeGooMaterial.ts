import * as THREE from 'three';
import type { MascotPalette } from './mascotPalette';

const vertexShader = /* glsl */ `
  uniform float uSquashY;
  uniform float uSquashX;
  uniform float uVertexWobble;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vHeight;
  varying vec3 vLocal;

  void main() {
    vec3 pos = position;
    float wobble = sin(pos.y * 4.0 + uTime * 1.05) * uVertexWobble;
    pos.x += wobble;
    pos.z += wobble * 0.35;
    pos *= vec3(uSquashX, uSquashY, uSquashX);
    vLocal = pos;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    vHeight = clamp((position.y + 0.42) / 0.84, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  uniform vec3 uC4;
  uniform vec3 uInnerTint;
  uniform float uSpecular;
  uniform float uJellySoftness;
  uniform float uTime;
  uniform vec3 uLightDir;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vHeight;
  varying vec3 vLocal;

  vec3 grad5(float t) {
    if (t < 0.25) return mix(uC0, uC1, t / 0.25);
    if (t < 0.5) return mix(uC1, uC2, (t - 0.25) / 0.25);
    if (t < 0.75) return mix(uC2, uC3, (t - 0.5) / 0.25);
    return mix(uC3, uC4, (t - 0.75) / 0.25);
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    vec3 l = normalize(uLightDir);
    float facing = max(dot(n, v), 0.0);
    float fresnel = pow(1.0 - facing, 2.4);

    float flowT = vHeight
      + sin(vLocal.x * 3.2 + uTime * 0.14) * 0.016
      + sin(vLocal.y * 2.6 - uTime * 0.12) * 0.014
      + cos(vLocal.z * 2.8 + uTime * 0.1) * 0.012;
    vec3 base = grad5(clamp(flowT, 0.0, 1.0));
    base = mix(base, uC2, 0.22);

    float sss = pow(1.0 - facing, 1.6);
    base = mix(base, uC1, sss * 0.18);

    float spec = pow(max(dot(n, normalize(l + vec3(0.1, 0.26, 0.16))), 0.0), 48.0) * uSpecular;
    base += mix(uC3, vec3(1.0), 0.35) * spec * 0.85;

    float rim = fresnel * 0.72;
    base += mix(uC3, uC4, 0.45) * rim;

    base = mix(base, uInnerTint, (1.0 - facing) * 0.32 + fresnel * 0.12);

    float alpha = mix(0.34, 0.58, uJellySoftness);
    alpha += fresnel * 0.14;
    alpha = clamp(alpha, 0.28, 0.72);

    gl_FragColor = vec4(base, alpha);
  }
`;

const SHELL_HIGHLIGHT = new THREE.Vector3(1, 1, 1);

/** Shell tone trim — keep vivid blue, minimal gray crush. */
const SHELL_DARKEN = 0.94;

function shellStopColor(
  body: MascotPalette['body'],
  stop: keyof MascotPalette['body'],
  inner: THREE.Vector3,
): THREE.Vector3 {
  return body[stop]
    .clone()
    .lerp(inner, 0.1)
    .lerp(SHELL_HIGHLIGHT, 0.22)
    .multiplyScalar(SHELL_DARKEN);
}

export function createSlimeGooMaterial(palette: MascotPalette): THREE.ShaderMaterial {
  const { body } = palette;
  const innerAnchor = palette.inner.deep.clone().lerp(palette.inner.mid, 0.35);
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uSquashY: { value: 1 },
      uSquashX: { value: 1 },
      uVertexWobble: { value: 0 },
      uC0: { value: shellStopColor(body, 'c0', innerAnchor) },
      uC1: { value: shellStopColor(body, 'c1', innerAnchor) },
      uC2: { value: shellStopColor(body, 'c2', innerAnchor) },
      uC3: { value: shellStopColor(body, 'c3', innerAnchor) },
      uC4: { value: shellStopColor(body, 'c4', innerAnchor) },
      uInnerTint: { value: innerAnchor.clone().multiplyScalar(0.9) },
      uSpecular: { value: palette.specularStrength * 0.92 },
      uJellySoftness: { value: palette.jellySoftness },
      uLightDir: { value: new THREE.Vector3(0.2, 0.95, 0.38).normalize() },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

export type SlimeGooUniforms = THREE.ShaderMaterial['uniforms'];
