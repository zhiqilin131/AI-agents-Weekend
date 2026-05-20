import * as THREE from 'three';
import { boostInnerSaturation, type MascotPalette } from './mascotPalette';

/** Inner color fill vs base (1 = full). */
export const SLIME_CORE_FILL = 0.9;

/** Overall inner opacity (center); rim fades via shader. */
export const SLIME_CORE_OPACITY = 0.78;

/** Extra saturation in shader + palette boost for inner core. */
const CORE_SATURATION = 1.22;

/** Flow wave speed — higher = more visible liquid motion. */
const CORE_FLOW_SPEED = 0.46;

const CORE_EDGE_FLOW = 0.12;
const CORE_EDGE_RIM = 0.16;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vLocal;
  varying vec3 vSphere;
  varying float vRadial;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec3 pos = position;
    vec3 n = normalize(normal);
    float t = uTime * ${CORE_FLOW_SPEED.toFixed(2)};
    float tSlow = uTime * 0.14;
    float u = atan(pos.z, pos.x);
    float r = length(pos);
    float edgeMask = smoothstep(0.22, 0.38, r);
    float coreMask = 1.0 - smoothstep(0.05, 0.32, r);

    float edgeWobble = sin(u * 2.0 + t * 0.38) * 0.012 * edgeMask;
    float swell =
      sin(pos.x * 1.85 + tSlow * 0.85) * sin(pos.y * 1.7 - tSlow * 0.78) * 0.011 * coreMask
      + sin(pos.z * 1.55 + t * 0.55) * 0.009 * coreMask
      + sin(dot(pos, vec3(0.4, 0.9, 0.2)) * 2.2 + t * 0.62) * 0.007 * coreMask;

    pos += n * (edgeWobble + swell + uPulse * 0.011);
    vLocal = pos;
    vSphere = normalize(position);
    vRadial = length(pos);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vNormal = normalize(normalMatrix * n);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform float uFill;
  uniform float uOpacity;
  uniform float uSaturation;
  uniform vec3 uCore;
  uniform vec3 uFlowA;
  uniform vec3 uFlowB;
  uniform vec3 uGlow;
  uniform vec3 uLightDir;
  varying vec3 vLocal;
  varying vec3 vSphere;
  varying float vRadial;
  varying vec3 vNormal;
  varying vec3 vView;

  float softBlob(vec3 p, vec3 c, float radius) {
    return smoothstep(radius, radius * 0.12, length(p - c));
  }

  vec3 saturateColor(vec3 c, float amount) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return clamp(mix(vec3(l), c, amount), 0.0, 1.0);
  }

  float silkNoise(vec3 p, float t) {
    float a = sin(p.x * 2.05 + t * 0.52) * sin(p.y * 1.85 - t * 0.46);
    float b = cos(p.z * 1.95 + t * 0.44) * sin((p.x + p.y) * 1.25 + t * 0.4);
    return smoothstep(0.34, 0.66, a * 0.5 + b * 0.5 + 0.5);
  }

  float sphereMarble(vec3 s, float t) {
    float band = sin(s.x * 3.4 + sin(s.y * 4.2 + t * 0.42) * 1.8 + t * 0.35);
    float swirl = sin(s.z * 3.1 + sin(s.x * 2.6 - t * 0.28) * 1.35 - t * 0.22);
    return smoothstep(0.2, 0.8, band * 0.42 + swirl * 0.38 + 0.5);
  }

  float liquidStream(vec3 s, vec3 local, float t, float tSlow) {
    float warp = sin(s.y * 4.5 + tSlow * 0.35) * 1.4;
    float s1 = sin(s.x * 4.8 + warp + t * 0.95);
    float s2 = sin(s.z * 4.2 - t * 0.82 + sin(s.x * 3.0) * 0.9);
    float s3 = sin(local.x * 2.4 + local.y * 2.1 - t * 1.05) * cos(local.z * 2.2 + t * 0.88);
    return smoothstep(0.38, 0.92, s1 * s2 * 0.55 + s3 * 0.45 + 0.5);
  }

  float causticBands(vec3 p, float t) {
    float c1 = sin(p.x * 3.6 + t * 1.15) * sin(p.y * 3.1 - t * 0.98);
    float c2 = cos(p.z * 2.9 + t * 0.88) * sin((p.x - p.z) * 2.5 + t * 0.72);
    return pow(max(c1 * 0.5 + c2 * 0.5 + 0.5, 0.0), 2.2);
  }

  void main() {
    float t = uTime * ${CORE_FLOW_SPEED.toFixed(2)};
    float tSlow = uTime * 0.14;
    float u = atan(vSphere.z, vSphere.x);
    float r = vRadial;

    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    vec3 l = normalize(uLightDir);
    float wrap = clamp((dot(n, l) + 0.52) / 1.52, 0.0, 1.0);
    float nl = max(dot(n, l), 0.0);

    float coreDisc = 1.0 - smoothstep(0.06, 0.36, r);
    coreDisc = smoothstep(0.0, 1.0, coreDisc);

    float edgeBand = smoothstep(0.26, 0.4, r);
    float edgeWobble = sin(u * 2.0 + t * 0.38) * 0.4 * edgeBand;

    vec3 drift1 = vec3(sin(t * 1.05) * 0.12, cos(t * 0.96) * 0.1, sin(t * 0.9) * 0.11);
    vec3 drift2 = vec3(cos(t * 0.86) * 0.11, sin(t * 0.92) * 0.1, cos(t * 0.8) * 0.105);
    vec3 drift3 = vec3(sin(t * 0.72) * 0.09, cos(t * 0.78) * 0.085, sin(t * 0.66) * 0.09);
    vec3 drift4 = vec3(cos(t * 0.58) * 0.08, sin(t * 0.64) * 0.075, cos(t * 0.52) * 0.08);
    float blob1 = softBlob(vLocal, drift1, 0.32) * coreDisc;
    float blob2 = softBlob(vLocal, drift2, 0.28) * coreDisc;
    float blob3 = softBlob(vLocal, drift3, 0.24) * coreDisc;
    float blob4 = softBlob(vLocal, drift4, 0.2) * coreDisc;

    float gooWave =
      sin(vLocal.x * 1.65 + t * 0.92) * 0.5
      + sin(vLocal.y * 1.5 - t * 0.84) * 0.5
      + cos(vLocal.z * 1.42 + t * 0.76) * 0.45;
    gooWave = smoothstep(0.15, 0.85, gooWave * 0.5 + 0.5);

    float marble = sphereMarble(vSphere, t) * coreDisc;
    float silk = silkNoise(vLocal * 0.92, tSlow) * coreDisc;
    float stream = liquidStream(vSphere, vLocal, t, tSlow) * coreDisc;
    float caustic = causticBands(vLocal, t) * coreDisc;

    float flow = coreDisc * 0.5 + uPulse * 0.08;
    flow += edgeWobble * ${CORE_EDGE_FLOW.toFixed(2)} + gooWave * 0.14 + stream * 0.22;
    flow += blob1 * 0.15 + blob2 * 0.13 + blob3 * 0.11 + blob4 * 0.09 + marble * 0.12 + silk * 0.05;
    flow = clamp(flow * uFill, 0.0, 1.0);

    float topLift = smoothstep(-0.12, 0.82, vSphere.y);
    float facing = max(dot(n, v), 0.0);
    float fresnel = pow(1.0 - facing, 2.4);
    float cavity = pow(1.0 - wrap, 1.35) * coreDisc;
    float depthShade = mix(0.72, 1.08, wrap) * mix(0.82, 1.06, topLift) * mix(0.88, 1.0, 1.0 - cavity * 0.35);

    vec3 flowRipple = vec3(
      sin(vLocal.x * 2.5 + t * 1.05),
      sin(vLocal.y * 2.3 - t * 0.92),
      cos(vLocal.z * 2.1 + t * 0.85)
    ) * 0.2 * coreDisc;
    vec3 liqN = normalize(n + flowRipple);
    float liqWrap = clamp((dot(liqN, l) + 0.48) / 1.48, 0.0, 1.0);

    vec3 poolDeep = mix(uFlowB * 0.82, uFlowA, 0.38 + marble * 0.42 + stream * 0.2);
    vec3 poolMid = mix(uFlowA, uFlowB, flow * 0.62 + blob1 * 0.3 + stream * 0.15);
    poolMid = mix(poolMid, uCore, (1.0 - flow) * 0.16 * coreDisc);
    vec3 poolBright = mix(uFlowA, uGlow, gooWave * 0.68 + blob2 * 0.42 + topLift * 0.16 + caustic * 0.35);

    vec3 base = mix(poolDeep, poolMid, smoothstep(0.1, 0.72, flow + stream * 0.12));
    base = mix(base, poolBright, smoothstep(0.3, 1.0, blob3 + blob4 + caustic * 0.6) * 0.45 * coreDisc);
    base *= depthShade;

    base = mix(base, poolDeep, cavity * 0.14);
    base += uGlow * fresnel * 0.2;
    base += uGlow * (1.0 - facing) * liqWrap * 0.18;
    base += mix(uFlowA, vec3(1.0), 0.35) * caustic * 0.14 * coreDisc;
    base += uFlowA * stream * 0.1 * coreDisc;

    float spec = pow(max(dot(liqN, normalize(l + v * 0.25)), 0.0), 28.0);
    float spec2 = pow(max(dot(liqN, normalize(l - v * 0.12)), 0.0), 12.0);
    base += vec3(1.0, 0.99, 1.0) * spec * 0.38 * (0.35 + coreDisc * 0.55);
    base += uFlowA * spec2 * 0.12 * stream;

    float rim = pow(1.0 - facing, 2.2) * edgeBand;
    base += mix(uFlowA, uGlow, 0.75) * rim * ${CORE_EDGE_RIM.toFixed(2)};
    base += mix(uFlowB, uFlowA, 0.5) * nl * 0.06 * coreDisc;

    base = saturateColor(base, uSaturation);
    base *= mix(0.97, 1.04, coreDisc);

    float alpha = uOpacity;
    alpha *= mix(0.36, 1.0, coreDisc);
    alpha *= mix(1.0, 0.7, edgeBand);
    alpha *= mix(0.88, 1.0, liqWrap);

    gl_FragColor = vec4(clamp(base, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
  }
`;

export function createSlimeCoreFlowMaterial(palette: MascotPalette): THREE.ShaderMaterial {
  const { inner } = palette;
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uFill: { value: SLIME_CORE_FILL },
      uOpacity: { value: SLIME_CORE_OPACITY },
      uSaturation: { value: CORE_SATURATION },
      uCore: { value: boostInnerSaturation(inner.base.clone(), 1.34) },
      uFlowA: { value: boostInnerSaturation(inner.mid.clone(), 1.42) },
      uFlowB: { value: boostInnerSaturation(inner.deep.clone(), 1.44) },
      uGlow: { value: boostInnerSaturation(inner.glow.clone(), 1.4).multiplyScalar(0.48) },
      uLightDir: { value: new THREE.Vector3(0.22, 0.94, 0.36).normalize() },
    },
  });
}
