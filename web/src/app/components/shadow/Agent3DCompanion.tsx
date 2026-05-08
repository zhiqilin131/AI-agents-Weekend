'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import { ACESFilmicToneMapping, AdditiveBlending, Color, SRGBColorSpace } from 'three';
import type { Group, Mesh, MeshBasicMaterial, Points as PointsType, PointsMaterial } from 'three';
import type { AgentStatus } from './types';

export type AgentMode =
  | 'idle'
  | 'reading_memory'
  | 'thinking'
  | 'responding'
  | 'updating_profile'
  | 'decision_detected'
  | 'report_generating'
  | 'report_complete'
  | 'scheduling'
  | 'error'
  | 'report_open';

/** Per-mode visual targets — damped toward these each frame for smooth transitions */
type ModeTargets = {
  glow: string;
  eye: string;
  coreTint: string;
  ringSpeed: number;
  /** Slow body breath amplitude (thinking: large; responding: small) */
  breatheAmp: number;
  breatheHz: number;
  /** Extra micro jitter on responding (streaming feel) */
  streamMicroAmp: number;
  streamMicroHz: number;
  emissiveIntensity: number;
  /** Halo scale multiplier */
  haloScale: number;
  haloAlpha: number;
  orbitNodeRadius: number;
  constellationOpacity: number;
  rippleOpacity: number;
  /** 0–1: how strongly the body morphs toward this mode's silhouette */
  morphThinking: number;
  morphResponding: number;
  morphReading: number;
};

const MODE_TARGETS: Record<AgentMode, ModeTargets> = {
  idle: {
    glow: '#636cf7',
    eye: '#7dd3fc',
    coreTint: '#a8b4ff',
    ringSpeed: 0.42,
    breatheAmp: 0.055,
    breatheHz: 0.35,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: 1.15,
    haloScale: 1.22,
    haloAlpha: 0.16,
    orbitNodeRadius: 0.95,
    constellationOpacity: 0,
    rippleOpacity: 0,
    morphThinking: 0,
    morphResponding: 0,
    morphReading: 0,
  },
  reading_memory: {
    glow: '#0ea5e9',
    eye: '#7df9ff',
    coreTint: '#7ec8ff',
    ringSpeed: 1.85,
    breatheAmp: 0.08,
    breatheHz: 1.05,
    streamMicroAmp: 0.012,
    streamMicroHz: 3.8,
    emissiveIntensity: 1.45,
    haloScale: 1.32,
    haloAlpha: 0.26,
    orbitNodeRadius: 1.04,
    constellationOpacity: 0,
    rippleOpacity: 0.14,
    morphThinking: 0,
    morphResponding: 0,
    morphReading: 1,
  },
  thinking: {
    /** Distinct from idle (cool indigo): warm magenta / fuchsia “cognition” read */
    glow: '#f0abfc',
    eye: '#fef08a',
    coreTint: '#86198f',
    ringSpeed: 1.35,
    /** Deep, slow lung-like breath — clearly different from responding */
    breatheAmp: 0.18,
    breatheHz: 0.36,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: 1.55,
    haloScale: 1.38,
    haloAlpha: 0.32,
    orbitNodeRadius: 1.04,
    constellationOpacity: 1,
    rippleOpacity: 0,
    morphThinking: 1,
    morphResponding: 0,
    morphReading: 0,
  },
  responding: {
    glow: '#2563eb',
    eye: '#f0fbff',
    coreTint: '#38bdf8',
    ringSpeed: 0.82,
    breatheAmp: 0.036,
    breatheHz: 1.25,
    streamMicroAmp: 0.04,
    streamMicroHz: 8.5,
    emissiveIntensity: 1.75,
    haloScale: 1.26,
    haloAlpha: 0.22,
    orbitNodeRadius: 0.98,
    constellationOpacity: 0,
    rippleOpacity: 0.9,
    morphThinking: 0,
    morphResponding: 1,
    morphReading: 0,
  },
  updating_profile: {
    glow: '#9333ea',
    eye: '#f3e8ff',
    coreTint: '#c4b5fd',
    ringSpeed: 1.25,
    breatheAmp: 0.095,
    breatheHz: 0.95,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: 1.5,
    haloScale: 1.34,
    haloAlpha: 0.26,
    orbitNodeRadius: 1.06,
    constellationOpacity: 0,
    rippleOpacity: 0.06,
    morphThinking: 0,
    morphResponding: 0,
    morphReading: 0.25,
  },
  decision_detected: {
    glow: '#eab308',
    eye: '#fffbeb',
    coreTint: '#fde68a',
    ringSpeed: 0.88,
    breatheAmp: 0.072,
    breatheHz: 0.48,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: 1.48,
    haloScale: 1.34,
    haloAlpha: 0.26,
    orbitNodeRadius: 1.04,
    constellationOpacity: 0.55,
    rippleOpacity: 0,
    morphThinking: 0.55,
    morphResponding: 0,
    morphReading: 0,
  },
  report_generating: {
    glow: '#7c3aed',
    eye: '#ede9fe',
    coreTint: '#a78bfa',
    ringSpeed: 2.05,
    breatheAmp: 0.07,
    breatheHz: 0.72,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: 1.65,
    haloScale: 1.42,
    haloAlpha: 0.34,
    orbitNodeRadius: 1.16,
    constellationOpacity: 0.92,
    rippleOpacity: 0.26,
    morphThinking: 0.72,
    morphResponding: 0,
    morphReading: 0,
  },
  report_complete: {
    glow: '#4f72ff',
    eye: '#e0ebff',
    coreTint: '#93b4ff',
    ringSpeed: 0.32,
    breatheAmp: 0.04,
    breatheHz: 0.28,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: 1.1,
    haloScale: 1.18,
    haloAlpha: 0.12,
    orbitNodeRadius: 0.92,
    constellationOpacity: 0,
    rippleOpacity: 0,
    morphThinking: 0,
    morphResponding: 0,
    morphReading: 0,
  },
  scheduling: {
    glow: '#3b76f7',
    eye: '#caf0ff',
    coreTint: '#8fb8ff',
    ringSpeed: 0.92,
    breatheAmp: 0.062,
    breatheHz: 0.55,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: 1.35,
    haloScale: 1.28,
    haloAlpha: 0.2,
    orbitNodeRadius: 0.96,
    constellationOpacity: 0,
    rippleOpacity: 0,
    morphThinking: 0,
    morphResponding: 0,
    morphReading: 0.35,
  },
  error: {
    glow: '#ea580c',
    eye: '#ffedd5',
    coreTint: '#fdba74',
    ringSpeed: 0.38,
    breatheAmp: 0.07,
    breatheHz: 0.42,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: 1.42,
    haloScale: 1.26,
    haloAlpha: 0.35,
    orbitNodeRadius: 0.95,
    constellationOpacity: 0,
    rippleOpacity: 0,
    morphThinking: 0,
    morphResponding: 0,
    morphReading: 0,
  },
  report_open: {
    glow: '#5f76ff',
    eye: '#dbe7ff',
    coreTint: '#9eb5ff',
    ringSpeed: 0.42,
    breatheAmp: 0.05,
    breatheHz: 0.32,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: 1.12,
    haloScale: 1.22,
    haloAlpha: 0.16,
    orbitNodeRadius: 0.94,
    constellationOpacity: 0,
    rippleOpacity: 0,
    morphThinking: 0,
    morphResponding: 0,
    morphReading: 0,
  },
};

function damp(cur: number, target: number, lambda: number, dt: number) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

const DRIFT_PARTICLE_COUNT = 56;

function createDriftParticleSystem() {
  const count = DRIFT_PARTICLE_COUNT;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const seeds = new Float32Array(count);

  const reset = (i: number) => {
    const rx = Math.random() * 2 - 1;
    const ry = Math.random() * 2 - 1;
    const rz = Math.random() * 2 - 1;
    let len = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    const r0 = 0.05 + Math.random() * 0.16;
    positions[i * 3] = (rx / len) * r0;
    positions[i * 3 + 1] = (ry / len) * r0;
    positions[i * 3 + 2] = (rz / len) * r0;
    let vx = positions[i * 3] * (1.2 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.5;
    let vy = positions[i * 3 + 1] * (1.2 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.5;
    let vz = positions[i * 3 + 2] * (1.2 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.5;
    len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    const spd = 0.16 + Math.random() * 0.48;
    velocities[i * 3] = (vx / len) * spd;
    velocities[i * 3 + 1] = (vy / len) * spd;
    velocities[i * 3 + 2] = (vz / len) * spd;
    phases[i] = Math.random() * Math.PI * 2;
  };

  for (let i = 0; i < count; i++) {
    seeds[i] = Math.random() * 400;
    reset(i);
  }

  return { count, positions, velocities, phases, seeds, reset };
}

function supportsWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function CompanionMesh({
  mode,
  hoverIntensity,
  pointer,
}: {
  mode: AgentMode;
  hoverIntensity: number;
  pointer: { x: number; y: number };
}) {
  const groupRef = useRef<Group>(null);
  const coreGroupRef = useRef<Group>(null);
  const ringRef = useRef<Mesh>(null);
  const rippleRef = useRef<Mesh>(null);
  const nodesRef = useRef<Group>(null);
  const leftEyeRef = useRef<Mesh>(null);
  const rightEyeRef = useRef<Mesh>(null);
  const haloMeshRef = useRef<Mesh>(null);

  const nucleusMatRef = useRef<MeshBasicMaterial>(null);
  /** Unlit body + ring so color stays vivid across GPUs / tone-mapping (Standard was washing out to gray). */
  const coreMatRef = useRef<MeshBasicMaterial>(null);
  const ringMatRef = useRef<MeshBasicMaterial>(null);
  const haloMatRef = useRef<MeshBasicMaterial>(null);
  const rippleMatRef = useRef<MeshBasicMaterial>(null);
  const smileMatRef = useRef<MeshBasicMaterial>(null);
  const constellMatRefs = useRef<(MeshBasicMaterial | null)[]>([null, null, null]);
  const driftPointsRef = useRef<PointsType>(null);
  const driftMatRef = useRef<PointsMaterial>(null);
  const driftData = useMemo(() => createDriftParticleSystem(), []);

  const goalGlow = useRef(new Color());
  const goalEye = useRef(new Color());
  const goalTint = useRef(new Color());
  const curGlow = useRef(new Color(MODE_TARGETS.idle.glow));
  const curEye = useRef(new Color(MODE_TARGETS.idle.eye));
  const curTint = useRef(new Color(MODE_TARGETS.idle.coreTint));

  const smooth = useRef({
    ringSpeed: MODE_TARGETS.idle.ringSpeed,
    breatheAmp: MODE_TARGETS.idle.breatheAmp,
    breatheHz: MODE_TARGETS.idle.breatheHz,
    streamMicroAmp: 0,
    streamMicroHz: 0,
    emissiveIntensity: MODE_TARGETS.idle.emissiveIntensity,
    haloScale: MODE_TARGETS.idle.haloScale,
    haloAlpha: MODE_TARGETS.idle.haloAlpha,
    orbitNodeRadius: MODE_TARGETS.idle.orbitNodeRadius,
    constellationOpacity: 0,
    rippleOpacity: 0,
    morphThinking: 0,
    morphResponding: 0,
    morphReading: 0,
  });

  const chromaBoost = useRef(new Color());

  const ringAngle = useRef(0);
  const prevModeRef = useRef<AgentMode>(mode);
  const nodes = useMemo(() => Array.from({ length: mode === 'report_generating' ? 9 : 4 }), [mode]);

  useFrame((state) => {
    const dt = Math.min(state.clock.getDelta(), 0.05);
    const t = state.clock.getElapsedTime();
    const target = MODE_TARGETS[mode];

    if (prevModeRef.current !== mode) {
      prevModeRef.current = mode;
      curGlow.current.setStyle(target.glow);
      curEye.current.setStyle(target.eye);
      curTint.current.setStyle(target.coreTint);
      chromaBoost.current.copy(curGlow.current).lerp(curTint.current, 0.35);
      Object.assign(smooth.current, {
        ringSpeed: target.ringSpeed,
        breatheAmp: target.breatheAmp,
        breatheHz: target.breatheHz,
        streamMicroAmp: target.streamMicroAmp,
        streamMicroHz: target.streamMicroHz,
        emissiveIntensity: target.emissiveIntensity,
        haloScale: target.haloScale,
        haloAlpha: target.haloAlpha,
        orbitNodeRadius: target.orbitNodeRadius,
        constellationOpacity: target.constellationOpacity,
        rippleOpacity: target.rippleOpacity,
        morphThinking: target.morphThinking,
        morphResponding: target.morphResponding,
        morphReading: target.morphReading,
      });
    }

    goalGlow.current.setStyle(target.glow);
    goalEye.current.setStyle(target.eye);
    goalTint.current.setStyle(target.coreTint);
    const colorLambda = 5.2;
    curGlow.current.lerp(goalGlow.current, 1 - Math.exp(-colorLambda * dt));
    curEye.current.lerp(goalEye.current, 1 - Math.exp(-colorLambda * dt));
    curTint.current.lerp(goalTint.current, 1 - Math.exp(-colorLambda * dt));
    chromaBoost.current.copy(curGlow.current).lerp(curTint.current, 0.35);

    const s = smooth.current;
    s.ringSpeed = damp(s.ringSpeed, target.ringSpeed, 4.5, dt);
    s.breatheAmp = damp(s.breatheAmp, target.breatheAmp, 4.2, dt);
    s.breatheHz = damp(s.breatheHz, target.breatheHz, 4.2, dt);
    s.streamMicroAmp = damp(s.streamMicroAmp, target.streamMicroAmp, 5, dt);
    s.streamMicroHz = damp(s.streamMicroHz, target.streamMicroHz, 5, dt);
    s.emissiveIntensity = damp(s.emissiveIntensity, target.emissiveIntensity, 4, dt);
    s.haloScale = damp(s.haloScale, target.haloScale, 3.8, dt);
    s.haloAlpha = damp(s.haloAlpha, target.haloAlpha, 4, dt);
    s.orbitNodeRadius = damp(s.orbitNodeRadius, target.orbitNodeRadius, 3.5, dt);
    s.constellationOpacity = damp(s.constellationOpacity, target.constellationOpacity, 4.5, dt);
    s.rippleOpacity = damp(s.rippleOpacity, target.rippleOpacity, 5, dt);
    s.morphThinking = damp(s.morphThinking, target.morphThinking, 4.8, dt);
    s.morphResponding = damp(s.morphResponding, target.morphResponding, 5, dt);
    s.morphReading = damp(s.morphReading, target.morphReading, 4.6, dt);

    const breath =
      1 +
      s.breatheAmp * Math.sin(t * Math.PI * 2 * s.breatheHz) +
      (s.streamMicroAmp > 0.001 ? s.streamMicroAmp * Math.sin(t * Math.PI * 2 * s.streamMicroHz) : 0);

    if (groupRef.current) {
      groupRef.current.rotation.y += 0.001 + s.ringSpeed * 0.00085;
      groupRef.current.rotation.x = pointer.y * 0.08;
      groupRef.current.position.y = Math.sin(t * 0.9) * 0.042;
      const hover = 1 + hoverIntensity * 0.035;
      groupRef.current.scale.setScalar(hover);
    }

    ringAngle.current += dt * s.ringSpeed;
    if (ringRef.current) {
      ringRef.current.rotation.z = ringAngle.current;
      ringRef.current.rotation.x = Math.sin(t * 0.7) * 0.22 + Math.PI / 4;
    }

    if (rippleRef.current) {
      const wave = 1 + Math.sin(t * 5.2) * 0.09 * s.rippleOpacity + Math.sin(t * 7.8) * 0.05 * s.rippleOpacity;
      rippleRef.current.scale.setScalar(wave);
      rippleRef.current.visible = s.rippleOpacity > 0.04;
    }
    if (rippleMatRef.current) {
      rippleMatRef.current.opacity = s.rippleOpacity * 0.55;
      rippleMatRef.current.color.copy(curGlow.current);
    }

    if (coreGroupRef.current) {
      const ph = Math.sin(t * Math.PI * 2 * s.breatheHz);
      const ph2 = Math.cos(t * Math.PI * 2 * s.breatheHz);
      let sx = breath;
      let sy = breath;
      let sz = breath;
      const mt = s.morphThinking;
      sx *= 1 + 0.14 * ph * mt;
      sy *= 1 - 0.11 * ph * mt;
      sz *= 1 + 0.08 * ph2 * mt;
      const mr = s.morphResponding;
      if (mr > 0.01) {
        const st = Math.sin(t * Math.PI * 2 * Math.max(s.streamMicroHz, 4));
        sx *= 1 + 0.048 * st * mr;
        sy *= 1 + 0.034 * Math.sin(st * 1.9 + 1) * mr;
        sz *= 1 + 0.038 * Math.cos(st * 2.4) * mr;
      }
      const mrd = s.morphReading;
      if (mrd > 0.01) {
        const scan = Math.sin(t * 2.35);
        sx *= 1 + (0.12 * scan + 0.05 * Math.sin(t * 5.1)) * mrd;
        sy *= 1 - 0.07 * Math.abs(scan) * mrd;
        sz *= 1 + 0.04 * Math.cos(t * 3.2) * mrd;
      }
      coreGroupRef.current.scale.set(sx, sy, sz);
    }
    if (haloMeshRef.current) {
      haloMeshRef.current.scale.setScalar(1.14 * s.haloScale * (0.92 + 0.08 * breath));
    }

    if (coreMatRef.current) {
      coreMatRef.current.color
        .copy(curTint.current)
        .lerp(curGlow.current, 0.52 + hoverIntensity * 0.1 + s.morphThinking * 0.06);
    }
    if (nucleusMatRef.current) {
      nucleusMatRef.current.color.copy(chromaBoost.current);
      nucleusMatRef.current.opacity = 0.92;
    }
    if (ringMatRef.current) {
      ringMatRef.current.color.copy(curGlow.current).lerp(curTint.current, 0.22);
      ringMatRef.current.opacity = 0.88 + s.haloAlpha * 0.1 + (s.morphResponding ? 0.02 : 0);
    }
    if (haloMatRef.current) {
      haloMatRef.current.color.copy(curGlow.current);
      haloMatRef.current.opacity = s.haloAlpha;
    }

    const eyeX = pointer.x * 0.015;
    const eyeY = pointer.y * 0.012;
    if (leftEyeRef.current) {
      leftEyeRef.current.position.x = -0.14 + eyeX;
      leftEyeRef.current.position.y = 0.1 + eyeY;
    }
    if (rightEyeRef.current) {
      rightEyeRef.current.position.x = 0.14 + eyeX;
      rightEyeRef.current.position.y = 0.1 + eyeY;
    }

    if (nodesRef.current) {
      nodesRef.current.rotation.y = -t * (0.2 + s.ringSpeed * 0.22);
      const rr = mode === 'report_generating' ? Math.max(s.orbitNodeRadius, 1.1) : s.orbitNodeRadius;
      const ch = nodesRef.current.children;
      const nodeOpacity = 0.42 + Math.min(s.haloAlpha * 2.2, 0.55);
      for (let i = 0; i < ch.length; i++) {
        const a = (i / Math.max(ch.length, 1)) * Math.PI * 2;
        ch[i].position.set(Math.cos(a) * rr, Math.sin(a * 1.4) * 0.18, Math.sin(a) * rr);
        const mat = (ch[i] as Mesh).material as MeshBasicMaterial | undefined;
        if (mat?.color) mat.color.copy(curGlow.current);
        if (mat) {
          mat.opacity = nodeOpacity;
          mat.transparent = true;
        }
      }
    }

    const starOp = s.constellationOpacity;
    constellMatRefs.current.forEach((mat) => {
      if (mat) {
        mat.opacity = starOp * 0.92;
        mat.transparent = true;
        mat.color.copy(curGlow.current).lerp(curEye.current, 0.25);
      }
    });

    if (smileMatRef.current) {
      smileMatRef.current.color.copy(curEye.current);
    }

    const eyeMaterials = [
      leftEyeRef.current?.material,
      rightEyeRef.current?.material,
    ].filter(Boolean) as MeshBasicMaterial[];
    eyeMaterials.forEach((m) => {
      m.color.copy(curEye.current);
      m.opacity = 0.88 + hoverIntensity * 0.08;
      m.transparent = true;
    });

    const {
      count: driftCount,
      positions: driftPos,
      velocities: driftVel,
      phases: driftPhases,
      seeds: driftSeeds,
      reset: resetDrift,
    } = driftData;
    const driftMaxR = 1.05 + s.haloAlpha * 0.38;
    const driftSpeed =
      0.48 + s.ringSpeed * 0.14 + s.emissiveIntensity * 0.06 + s.morphResponding * 0.42 + s.morphReading * 0.22;
    for (let i = 0; i < driftCount; i++) {
      const sd = driftSeeds[i];
      const w1 = Math.sin(t * 1.9 + sd) * 0.01;
      const w2 = Math.cos(t * 1.4 + sd * 0.73) * 0.01;
      const w3 = Math.sin(t * 2.7 + driftPhases[i]) * 0.007;
      driftPos[i * 3] += driftVel[i * 3] * dt * driftSpeed + w1;
      driftPos[i * 3 + 1] += driftVel[i * 3 + 1] * dt * driftSpeed + w2;
      driftPos[i * 3 + 2] += driftVel[i * 3 + 2] * dt * driftSpeed + w3;
      const dx = driftPos[i * 3];
      const dy = driftPos[i * 3 + 1];
      const dz = driftPos[i * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > driftMaxR || (d > 0.35 && Math.random() < 0.0035)) {
        resetDrift(i);
      }
    }
    const driftGeom = driftPointsRef.current?.geometry;
    if (driftGeom) {
      const posAttr = driftGeom.getAttribute('position');
      if (posAttr) posAttr.needsUpdate = true;
    }
    const dMat = driftMatRef.current;
    if (dMat) {
      dMat.color.copy(curGlow.current).lerp(curEye.current, 0.12);
      dMat.opacity = 0.28 + s.haloAlpha * 0.38 + hoverIntensity * 0.12 + s.morphThinking * 0.08;
      dMat.size = 0.019 + s.haloAlpha * 0.022 + s.morphResponding * 0.012;
    }
  });

  const showDecisionNodes = mode === 'decision_detected';
  const showScheduling = mode === 'scheduling';
  const showErrorAura = mode === 'error';
  const showReadingScan = mode === 'reading_memory';
  const showReportCards = mode === 'report_generating';
  const showProfileFlow = mode === 'updating_profile';
  /** Constellation fades via opacity — always mount, blend in during thinking/report */
  const constellationPositions = [[-0.42, 0.5, 0.1], [0.48, 0.43, 0.05], [0.05, 0.62, -0.3]] as const;

  return (
    <group ref={groupRef}>
      <Float speed={1.35} floatIntensity={0.36}>
        <mesh ref={haloMeshRef} scale={[1.2, 1.2, 1.2]}>
          <sphereGeometry args={[0.55, 28, 28]} />
          <meshBasicMaterial ref={haloMatRef} transparent />
        </mesh>
        <group ref={coreGroupRef}>
          <mesh>
            <sphereGeometry args={[0.24, 20, 20]} />
            <meshBasicMaterial ref={nucleusMatRef} transparent />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.55, 28, 28]} />
                <meshBasicMaterial ref={coreMatRef} />
          </mesh>
        </group>
        <mesh ref={leftEyeRef}>
          <sphereGeometry args={[0.046, 12, 12]} />
          <meshBasicMaterial transparent />
        </mesh>
        <mesh ref={rightEyeRef}>
          <sphereGeometry args={[0.046, 12, 12]} />
          <meshBasicMaterial transparent />
        </mesh>
        <mesh position={[0, -0.08, 0.5]} scale={[1, 0.6, 1]}>
          <torusGeometry args={[0.1, 0.012, 8, 30, Math.PI]} />
          <meshBasicMaterial ref={smileMatRef} />
        </mesh>
        <mesh ref={ringRef} rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[0.88, 0.022, 16, 56]} />
          <meshBasicMaterial ref={ringMatRef} transparent opacity={0.9} />
        </mesh>
        <mesh ref={rippleRef} rotation={[Math.PI / 2.2, 0, 0]}>
          <torusGeometry args={[1.08, 0.013, 12, 56]} />
          <meshBasicMaterial ref={rippleMatRef} transparent depthWrite={false} />
        </mesh>
        <group ref={nodesRef}>
          {nodes.map((_, i) => (
            <mesh key={i}>
              <sphereGeometry args={[0.038, 10, 10]} />
              <meshBasicMaterial transparent />
            </mesh>
          ))}
        </group>
        {showReadingScan ? (
          <mesh rotation={[Math.PI / 2.1, 0, 0]}>
            <torusGeometry args={[0.98, 0.01, 8, 40]} />
            <meshBasicMaterial color="#9ed8ffcc" transparent />
          </mesh>
        ) : null}
        <group>
          {constellationPositions.map((pos, idx) => (
            <mesh key={idx} position={[...pos] as [number, number, number]}>
              <sphereGeometry args={[0.032, 10, 10]} />
              <meshBasicMaterial
                ref={(el) => {
                  constellMatRefs.current[idx] = el;
                }}
                color="#c9bfff"
                transparent
                opacity={0}
                depthWrite={false}
              />
            </mesh>
          ))}
        </group>
        {showProfileFlow ? (
          <group>
            {[-0.6, -0.35, -0.1].map((x, idx) => (
              <mesh key={idx} position={[x, -0.16 + idx * 0.08, 0.25]}>
                <boxGeometry args={[0.07, 0.05, 0.03]} />
                <meshStandardMaterial color="#d9cbff" emissive="#a88eff" emissiveIntensity={0.35} />
              </mesh>
            ))}
          </group>
        ) : null}
        {showDecisionNodes ? (
          <group>
            {[-1, 0, 1].map((x) => (
              <mesh key={x} position={[x * 0.45, 0.58 - Math.abs(x) * 0.08, 0]}>
                <sphereGeometry args={[0.06, 12, 12]} />
                <meshBasicMaterial color="#e7c07b" />
              </mesh>
            ))}
          </group>
        ) : null}
        {showReportCards ? (
          <group>
            {[-0.55, 0, 0.55].map((x, idx) => (
              <mesh key={idx} position={[x, -0.52 + Math.abs(x) * 0.08, 0.2]}>
                <boxGeometry args={[0.16, 0.1, 0.02]} />
                <meshStandardMaterial color="#ddd7ff" emissive="#a68eff" emissiveIntensity={0.3} />
              </mesh>
            ))}
          </group>
        ) : null}
        {showScheduling ? (
          <group position={[0, -0.5, 0]}>
            {[-0.28, 0, 0.28].map((x) => (
              <mesh key={x} position={[x, 0, 0.5]}>
                <boxGeometry args={[0.16, 0.1, 0.08]} />
                <meshStandardMaterial color="#bcd2ff" emissive="#8296ff" emissiveIntensity={0.35} />
              </mesh>
            ))}
          </group>
        ) : null}
        {showErrorAura ? (
          <mesh>
            <sphereGeometry args={[0.75, 24, 24]} />
            <meshBasicMaterial color="#f59e7a22" transparent />
          </mesh>
        ) : null}
        <points ref={driftPointsRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[driftData.positions, 3]} />
          </bufferGeometry>
          <pointsMaterial
            ref={driftMatRef}
            transparent
            depthWrite={false}
            sizeAttenuation
            blending={AdditiveBlending}
            size={0.028}
            opacity={0.55}
          />
        </points>
      </Float>
    </group>
  );
}

/** Matches ShadowChatShell / page shell — not tied to agent mode color */
const COMPANION_FRAME_BG =
  'bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] border border-white/85';

function CompanionFallback({ mode }: { mode: AgentMode }) {
  const t = MODE_TARGETS[mode];
  return (
    <div className={`flex h-[220px] w-full items-center justify-center rounded-2xl ${COMPANION_FRAME_BG}`}>
      <div
        className="relative h-28 w-28 rounded-full transition-all duration-[800ms] ease-out"
        style={{
          transform: mode === 'thinking' ? 'scale(1.12)' : mode === 'responding' ? 'scale(1)' : undefined,
          background: `radial-gradient(circle at 35% 35%, ${t.coreTint}ee 0%, ${t.glow}cc 45%, ${t.glow}66 100%)`,
          boxShadow: `0 0 ${mode === 'responding' ? 52 : 40}px ${t.glow}77, inset 0 0 20px rgba(255,255,255,0.35)`,
        }}
      >
        <div
          className="absolute inset-[22%] rounded-full transition-colors duration-[800ms]"
          style={{
            background: `radial-gradient(circle, ${t.eye}99, ${t.coreTint}55)`,
            opacity: mode === 'responding' ? 0.95 : 0.88,
          }}
        />
      </div>
    </div>
  );
}

export function Agent3DCompanion({
  mode,
  onToggleTooltip,
  forceFallback = false,
}: {
  mode: AgentStatus;
  onToggleTooltip?: () => void;
  forceFallback?: boolean;
}) {
  const [isWebGLAvailable, setWebGLAvailable] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setWebGLAvailable(supportsWebGL());
  }, []);

  const mappedMode = (mode === 'report_open' ? 'report_complete' : mode) as AgentMode;

  if (forceFallback || !isWebGLAvailable) {
    return <CompanionFallback mode={mappedMode} />;
  }

  return (
    <div
      className={`h-[220px] w-full overflow-hidden rounded-2xl ${COMPANION_FRAME_BG}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPointer({ x: 0, y: 0 });
      }}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        setPointer({ x, y });
      }}
      onClick={onToggleTooltip}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggleTooltip?.();
      }}
      aria-label="Interactive Shadow companion"
    >
      <Canvas
        style={{ background: 'transparent' }}
        camera={{ position: [0, 0, 3.2], fov: 45 }}
        dpr={[1, 1.6]}
        gl={{
          alpha: true,
          premultipliedAlpha: false,
          outputColorSpace: SRGBColorSpace,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.02,
          antialias: true,
        }}
        onCreated={({ gl, scene }) => {
          scene.background = null;
          gl.setClearColor(0x000000, 0);
        }}
      >
        <ambientLight intensity={0.28} color="#b8c4ff" />
        <pointLight position={[2.1, 2.2, 2.4]} intensity={0.95} color="#8fa8ff" />
        <pointLight position={[-1.9, -0.6, 2.2]} intensity={0.62} color="#b8a8f5" />
        <pointLight position={[0, 2.6, 1.2]} intensity={0.38} color="#eef1ff" />
        <CompanionMesh mode={mappedMode} hoverIntensity={hovered ? 1 : 0} pointer={pointer} />
      </Canvas>
    </div>
  );
}

// TODO: Swap procedural mesh for a polished GLB companion.
// TODO: Explore VRM avatar support via @pixiv/three-vrm.
// TODO: Add optional lip-sync hooks (TalkingHead / wawa-lipsync).
// TODO: Add voice-driven animation states.
