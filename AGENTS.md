# AGENTS.md

Persistent context for coding agents. `plan.md` is the spec (architecture, contracts §6, functionalities F0–F10, "Done when" checks). This file holds only the current state, decisions that differ from or add to the plan, and facts learned. Keep it short; replace outdated lines instead of appending contradictions.

## Project
DGS (German Sign Language) → German voice over a browser-to-browser LiveKit call, for a deaf/non-speaking caller booking a doctor's appointment. MagdeHack, 24 h (13–14 Nov 2026). MVP: 15 fixed signs (p0), segment-then-classify, LLM (Gemma 4 31B via OpenRouter) turns glosses into one German sentence, ElevenLabs TTS into the call, ElevenLabs Scribe for captions.

## Roles
- **Person 2 = this user (Aditya), Lane B: F5–F8** (camera → token). The agent writes all code; the user signs, grants camera access, tests in the browser and reports results.
- Person 1 + own agent, Lane A: F1–F4, F9 (call, captions, voice, sentence, main page). Per the user, Lane A is implemented on person 1's laptop (not on GitHub yet).
- Cross-lane touchpoints: `web/lib/contract.ts`, `web/lib/labels.json` and F9 importing `SignCamera`.

## Status
- [x] F0 setup on `origin/main` (3286ac3). Nothing else is on `main`.
- [x] F5–F8 done and working on the user's laptop with real signing.
- [x] Tuning session on a real stream (results under Decisions).
- [x] Dataset: 15 × 15 p0 + 34 `_NONE` (signer `adi`) in `sign/data/` (gitignored, local only, 12 MB). Model **v0** trained: cnn1d, hold-out 48/48 (same session, optimistic), 1-NN 41/48; threshold 0.6 / margin 0.3. Live: works "good enough", still mistakes → retrain later.
- [x] **Handoff to Lane A pushed: `origin/feat/sign-integration`** (087370d) with `LANE_A_HANDOFF.md` (copy-paste prompt for person 1's agent, merge/conflict rules, F9 code, 4 s utterance gap, test steps) and v0 weights in `sign/models/`. `origin/feat/sign-live` is an older, fully contained push (can be deleted on user request).
- [ ] Person 1 merges `feat/sign-integration` into their branch and integrates `<SignCamera>` (mount on "Anrufen"). Then joint test on the demo laptop, then merge to `main` with user approval.
- [ ] Retrain with more/varied data (more samples, maybe a second signer); commit only `sign/models/config.json` + `model.pt`.

Branches: current work on `feat/sign-integration`. Older local stages: `feat/sign-camera` → `feat/sign-service` → `feat/sign-training` → `feat/sign-live` (all contained). Local `main` has 2 unpushed commits (AGENTS.md, contract change) that are also contained in the feature branches.

## Decisions and deviations from plan.md
- Git: feature branches only; `main` only after it works on the user's laptop and the user says so. Ask before every push.
- Contract change (in `contract.ts` + `plan.md` §6.2/§6.6, F4 rule 8, F9 step 2): `Token.question?: "yn" | "wh"`, `Token.negation?: boolean`; `/api/sentence` gets `question` (last non-empty among tokens, else null) and `negation` (any). Backwards compatible.
- **Signer lowers hands between signs** (recording and demo). Utterance ends **4 s** after the last token or on Enter (plan's 1.5 s changed; measured gaps between consecutive signs 2.5 s median, up to ~4.6 s).
- Signer name in sample files: `adi`. Python **3.12** (no `python3.11` here).
- npm packages pinned to versions ≥ 7 days old at install: next 16.4.6, react 19.3.0, livekit-client 2.23.0, livekit-server-sdk 2.19.1, @elevenlabs/client 1.35.0, @elevenlabs/elevenlabs-js 2.77.0, @mediapipe/tasks-vision 1.2.2. No new npm packages.
- Python installs: `uv pip install --python .venv/bin/python --exclude-newer <today−7d>`; pins in `sign/requirements.txt` (fastapi 0.162.2, uvicorn 0.54.0, numpy 2.5.4, scikit-learn 1.9.1, torch 2.14.1+cu126; CPU-only machines: torch 2.14.1 from the cpu index).
- Next.js 16 with create-next-app defaults (`cacheComponents`, `partialPrefetching`, Turbopack, `web/AGENTS.md`). Read `web/node_modules/next/dist/docs/` before writing Next code.
- `ELEVEN_LABS_VOICE_ID` = "Susi" (`v3V1d2rk6528UrLKRuy8`, German female), works with `eleven_flash_v2_5` + `language_code: "de"`. `LIVEKIT_ROOM` unset → `praxis-demo`.
- `SignCamera.tsx`: MediaPipe wasm from jsDelivr `@1.2.2`, models from `storage.googleapis.com/mediapipe-models` (hand float16, pose lite float16, face landmarker float16; ~32 MB first load, needs internet). 640×480@30, hands every frame, pose/face alternate every 3rd frame. Face sends `{bs: 29 blendshapes, rot: [yaw, pitch, roll]}`. Detection loop wrapped in try/catch (skips bad frames; error after 90 consecutive). TFLite "XNNPACK delegate" INFO line logged via console.error is filtered (it's not an error). Camera picker top-right when >1 camera (localStorage `signCameraId`, falls back to default). Brow badge threshold 0.3. Display mirrored via CSS only.
- Segmenter (`sign/core.py` constants): palm centres in shoulder widths vs shoulder midpoint, One Euro filtered, sides by nearest pose wrist. Active = visible and above `REST_Y` 1.2. Start: speed > 0.8 sw/s for 2 frames. End: no active hand 130 ms, or speed < 0.5 for 250 ms, or 3 s cap.
- Tuning results (log kept at `/tmp/sign_tuning_adi.jsonl`, 10 min): user's camera framing hides lowered hands → clean end ~150 ms after lowering; slow signs with hands lowered segment 1:1. Signs chained with hands up run into the 3 s cap; a grid search (speed window 1/100/150 ms × END_SPEED 0.3–0.9 × END_STILL 150–400 ms) found no setting that splits them without cutting holds inside slow signs → thresholds kept, hands-down rule instead. Brows: rest up 0.045 / down 0.034, raised 0.6–0.9, furrowed 0.3–0.9 → deltas 0.15 OK (5/5 flagged). Head shakes ±40–60° yaw, 0 false negations in 71 segments.
- Features: 159-dim per frame (2×[63 handshape, 4 location vs shoulders/nose, 2 velocity, 1 present] + 18 mouth/jaw blendshapes + face flag), 32 frames. Brows/head are token flags, not classifier input. 1D-CNN vs 1-NN, augmentation, rejection threshold/margin, final retrain on all data. Inference ~8.5 ms/sign CPU. `train.py` ~4 min on the GTX 1050 for 259 samples.
- Server (`sign/server.py`): loads `sign/models/` on each new WebSocket (picks up retrains). Localhost origins only. `POST /undo` (last sample of this process), `POST /reset/{label}?signer=` (all of that signer's samples for a label), `GET /health` (`model`, `fake`, counts). `SIGN_FAKE=A,B,C`: without a model, each detected sign emits the next gloss (for Lane A loop tests). `SIGN_DUMP=<file>` appends every frame (tuning; replay with `core.py <file>`). `SIGN_MODELS` / `SIGN_DATA` override folders.
- `/record`: always light theme (user's browser is dark mode), 50/50 columns. Record mode: only p0 + `_NONE` (p1 numbers/extras hidden, not recorded), target 15 (`_NONE` 30), auto-advance to the next unfinished label with double beep + 2.5 s pause (sends infer meanwhile), undo last, red reset-label button, SignDict reference video. Infer mode: dark prediction panel (green label / amber `?` + confidence, top 3, history chips), sentence builder (4 s gap / Enter / Backspace, flags shown).
- Training data: no usable public DGS set for our vocabulary (`fhswf/dgs-pose` gone; SignDict HF set has 1–3 clips/word, mostly CC BY-NC-SA → reference videos only, `web/lib/signRefs.json`). Optional later: pretrain on Kaggle ASL ISLR (54 GB, needs Kaggle API key) — only if accuracy for other signers matters.
- Practice sheet: `cd sign && .venv/bin/python make_practice.py` → `practice/index.html` (gitignored media: SignDict video + 6 key frames per sign, recording guide).
- `_NONE` = everyday non-sign movements (scratching, glasses, mouse, cup, stretch, casual wave, aborted sign); model output `_NONE` → `?`.

## Environment facts
- Repo `/home/adityaladawa/Desktop/mghack`, remote `https://github.com/DarshanScripts/magde-hack.git`.
- `.env` at repo root (gitignored), symlinked as `web/.env`. Keys: `ELEVEN_LABS_API_KEY`, `ELEVEN_LABS_VOICE_ID`, `OPENROUTER_API_KEY`, `LLM_MODEL=google/gemma-4-31b-it`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NGROK_AUTH_TOKEN`, `HF_TOKEN`. Never print or commit values; pass `ELEVEN_LABS_API_KEY` explicitly.
- GPU: GTX 1050 Mobile (sm_61, CUDA ≤ 12.6) + Intel UHD 630, KDE Wayland. CUDA only for training. GPU Chrome (separate instance, X11 mode): `prime-run google-chrome-stable --ozone-platform=x11 --user-data-dir=/tmp/chrome-nvidia http://localhost:3000/record` (`run.sh` does this). Brave (daily browser) stays on Intel. Only one app can hold a webcam.
- Cameras: laptop `/dev/video0` (640×480@30); **Pixel 7 in Android USB webcam mode** `/dev/video2` (MJPG/YUYV up to 1080p@60, 640×480@30 OK). Phone stream is landscape only → mount the phone sideways. Record and demo with the same camera.
- MediaPipe in GPU Chrome: hands 12 ms, pose 17 ms, face 18 ms per frame; ~16–24 fps with hands visible.
- Killing processes: `pkill -f "[u]vicorn server:app"` kills the calling shell too if the same command line contains the literal text later (e.g. a restart in the same call) → kill and restart in separate commands, or use `./stop.sh`.
- Chrome 151 installed (latest 157; user updates via `yay -S google-chrome`). ngrok 3.39.13 in `~/.local/bin`. Node 26, npm 11, `uv`.
- Agent can inspect the page via DevTools protocol: launch GPU Chrome with `--remote-debugging-port=9222 --use-fake-ui-for-media-stream`.

## Commands
```bash
./run.sh [page]                            # sign service :8765 (SIGN_DUMP on) + Next :3000 + browser; default /record
./stop.sh                                  # stop service, Next, GPU Chrome
cd web && npx tsc --noEmit && npm run lint # verify web code
cd sign && .venv/bin/python train.py       # retrain from sign/data → sign/models
cd sign && .venv/bin/python core.py <dump> # replay a stream log (segmentation tuning)
ngrok http 3000                            # callee device only
```
Teammate setup after pull: `cd web && npm ci && ln -s ../.env .env`; Python venv per `LANE_A_HANDOFF.md` §6.
