# Slime visual spec (Mascot 3D + fallback)

## Rendering paths

| Path | When | Entry |
|------|------|--------|
| **3D Mascot** | `VITE_SLIME_3D=1` + WebGL + motion OK | [`SlimeAdvisor3D`](web/src/features/slime/visual3d/SlimeAdvisor3D.tsx) |
| **2D SVG** | Fallback / `prefers-reduced-motion` | [`SlimeAdvisor2D`](web/src/app/components/report/SlimeAdvisor2D.tsx) |
| **Facade** | All touchpoints | [`SlimeAdvisor`](web/src/app/components/report/SlimeAdvisor.tsx) |

## Mascot palette (3D only, reference sheet)

Defined in [`mascotPalette.ts`](web/src/features/slime/visual3d/mascotPalette.ts). UI buttons still use [`slimeIdentity.ts`](web/src/features/slime/slimeIdentity.ts).

| Stop | Mochi | Rimumu |
|------|-------|--------|
| c0 (top) | `#E6F7FF` | `#FFF0F6` |
| c1 | `#BDEBFF` | `#FFD7EA` |
| c2 | `#83D8FF` | `#FFAED1` |
| c3 | `#47C6FF` | `#FF8EB8` |
| c4 (base) | `#1AA5E6` | `#FF6B9A` |

## Body

- [`mascotGeometry.ts`](web/src/features/slime/visual3d/mascotGeometry.ts): **shared round blob** for Mochi & Rimumu (identical scale).
- [`SlimeBodyMesh.tsx`](web/src/features/slime/visual3d/SlimeBodyMesh.tsx): **layered** inner core + gradient shell ([`SlimeGooMaterial.ts`](web/src/features/slime/visual3d/SlimeGooMaterial.ts)).
- Palette: [`mascotPalette.ts`](web/src/features/slime/visual3d/mascotPalette.ts) — vivid blue (Mochi) / pink (Rimumu).

## Face

- [`mascotFaceLayout.ts`](web/src/features/slime/visual3d/mascotFaceLayout.ts): wide-set large eyes, brow/mouth/blush positions on gumdrop upper face.
- [`SlimeFace.tsx`](web/src/features/slime/visual3d/SlimeFace.tsx): [`CuteSlimeEye.tsx`](web/src/features/slime/visual3d/CuteSlimeEye.tsx) sphere eyes (sclera + iris + pupil + highlights), tube smile, spherical cheek blush.
- [`slimeEyeExpression.ts`](web/src/features/slime/visual3d/slimeEyeExpression.ts): state → happy / curious / surprised / cautious; `uEyeOpen` for surprised.

| State | Expression |
|-------|------------|
| idle, speaking | happy |
| listening, thinking, remembering, preparing | curious |
| celebrating | surprised |
| cautious | cautious |

## Buddy hero

| Parameter | Value |
|-----------|--------|
| Container spread | `lg × 1.75` |
| `SLIME_HERO_BODY_SCALE` | 0.72 |
| Camera | `[0, 0.08, 2.65]`, fov 32 |
| Lighting | 3-point + [`ContactShadows`](web/src/features/slime/visual3d/variants/BuddyStageEnvironment.tsx) + light `Environment` |
| `toneMappingExposure` | 1.12 |

## Speaking motion limits

- Body `wobble` / `vertexWobble` = 0 while speaking.
- Mouth only; TTS amplitude EMA max 0.85.
- Eyes stay **happy** while speaking (no stare).

## Dev preview

`/#/dev/slime-3d` with `npm run dev` and `VITE_SLIME_3D=1`.
