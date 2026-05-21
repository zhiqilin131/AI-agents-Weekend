# Rimumu Therapy Exercise Lab (local)

Standalone prototype for interactive wellbeing exercises. **Not merged into main Buddy chat yet** — validate UI on branch `feat/rimumu-therapy-lab` first.

## Prerequisites

- Node.js (same as main `web` app)
- Optional: Python API on port **8765** if you need TTS voice guidance or “Add to Execution Calendar”

## Quick start (recommended — dedicated port)

From the repo root:

```bash
cd web
npm install
npm run dev:therapy-lab
```

Vite opens **http://127.0.0.1:5174/#/therapy-lab** automatically.

| URL | Purpose |
|-----|---------|
| `http://127.0.0.1:5174/#/therapy-lab` | Lab home (exercise picker + debug panel) |
| `http://127.0.0.1:5174/#/rimumu-lab` | Alias → redirects to `/therapy-lab` |

Main app stays on **5173** (`npm run dev`) — you can run both at once.

## With API (TTS + calendar)

```bash
cd web
npm run dev:therapy-lab:all
```

- Web lab: **5174**
- FastAPI: **8765** (proxied as `/api` from Vite)

## Same port as main app

If you already run `npm run dev` on 5173:

- **http://127.0.0.1:5173/#/therapy-lab**

No second server needed; hash route only.

## Auth note

If `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in `web/.env`, you must sign in first (same as the rest of the app). Without Supabase env, the lab loads without login.

## Exercises in the lab

1. **Breathing guide** — 4-2-6-2 orb (inhale / hold / exhale / hold), optional Rimumu TTS  
2. **Emotion check-in** — mood + intensity + support goal  
3. **5-4-3-2-1 grounding** — step cards  
4. **CBT thought reframe** — guided steps, non-diagnostic copy  
5. **Micro action plan** — tiny action + optional Execution Calendar  

Right column: **debug panel** (step, intensities, memory candidate, calendar title).

## Safety

Free-text fields run client-side safety checks. Crisis language pauses the exercise and shows the escalation panel (988 link). Not a substitute for emergency care.

## Code layout

- `web/src/pages/RimumuTherapyLabPage.tsx` — page shell  
- `web/src/features/therapyLab/` — exercises + shared model  
- `web/vite.therapy-lab.config.ts` — port 5174 dev config  
- Routes in `web/src/main.tsx`: `/therapy-lab`, `/rimumu-lab`

## 本地访问（中文）

**最简单：** 在 `web` 目录执行 `npm run dev:therapy-lab`，浏览器打开 **http://127.0.0.1:5174/#/therapy-lab**。

需要语音或日历时：`npm run dev:therapy-lab:all`（前端 5174 + 后端 8765）。

已在跑主站时也可访问：**http://127.0.0.1:5173/#/therapy-lab**。

Branch: `feat/rimumu-therapy-lab`（尚未合并到 `main`）。
