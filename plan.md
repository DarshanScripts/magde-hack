# DGS Call: MVP plan

A deaf or non-speaking person calls a medical practice from the browser and signs in **DGS** (Deutsche Gebärdensprache, German Sign Language).

- **Signs → tokens → German sentence → voice:** webcam → MediaPipe landmarks → Python sign model → tokens (`TERMIN`, `MORGEN`, `JA` …) → Gemma 4 31B turns tokens into one polite German sentence → ElevenLabs TTS speaks it into the LiveKit call.
- **Voice → captions:** the other person's speech → ElevenLabs Scribe realtime → live German captions.

Demo use case: book, move or cancel a doctor's appointment and say why (check-up, pain).

---

## 1. Stack

| Part | Choice |
|---|---|
| Languages | **TypeScript** for the web app, **Python 3.11/3.12** for sign recognition |
| Web app | Next.js (App Router) + React + Tailwind. One Next.js server handles both pages and API routes |
| Call | LiveKit Cloud: `livekit-client` in the browser, `livekit-server-sdk` in the token route |
| Captions (STT) | ElevenLabs Scribe Realtime `scribe_v3_live`, German. The browser connects to ElevenLabs directly with a single-use token (`@elevenlabs/client`) |
| Voice (TTS) | ElevenLabs `eleven_flash_v2_5` (~75 ms latency, supports German) via an API route (`@elevenlabs/elevenlabs-js`) |
| Sentence (LLM) | OpenRouter chat completions, `LLM_MODEL=google/gemma-4-31b-it` |
| Landmarks | MediaPipe Tasks Vision in the browser (`@mediapipe/tasks-vision`): HandLandmarker (2 hands) + PoseLandmarker lite |
| Sign recognition | Python service: FastAPI WebSocket + NumPy + PyTorch (GTX 1050 or CPU) |
| Tunnel | ngrok, needed only for the callee page on a phone or second device |

**Why this split**
- LiveKit, ElevenLabs realtime and MediaPipe all ship browser-first JS/TS SDKs. TypeScript types act as the shared contract between the agents.
- Features, segmentation, training and inference all live in one Python codebase. That means no duplicated feature code between training and live use, and the model can be retrained without touching the web app.

## 2. References: what similar projects use

| Project | What we take from it |
|---|---|
| [sign.mt](https://github.com/sign/translate) (open source, TypeScript web app) | Real-time sign↔spoken translation in the browser: camera → pose → segmentation → text → speech |
| [Kaggle ISLR 1st place](https://www.kaggle.com/competitions/asl-signs/writeups/hoyeol-sohn-1st-place-solution-1dcnn-combined-with) | MediaPipe landmarks → 1D-CNN (+Transformer), trained in PyTorch. A pure 1D-CNN beat the Transformer → we use a small 1D-CNN |
| [Kaggle ASL Fingerspelling 1st place](https://www.kaggle.com/competitions/asl-fingerspelling/writeups/darragh-dieter-1st-place-solution-improved-squeeze) | Keypoints from hands + arms + lips; augmentations: time stretch, finger dropout |
| [LiveKit spatial-audio example](https://github.com/livekit-examples/spatial-audio) | Publish Web Audio output as a call track (`MediaStreamDestination` → `publishTrack`) |
| [LiveKit components-js Next.js example](https://github.com/livekit/components-js) | Token route: `AccessToken` → `addGrant` → `await toJwt()` |
| [ElevenLabs client-side streaming](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming) | Scribe realtime in the browser: single-use token + manual PCM16 chunks |

## 3. Architecture

```
SIGNER LAPTOP (demo machine, GTX 1050) — Chrome on http://localhost:3000
  webcam ─▶ MediaPipe hands+pose ──frames──▶ ws://localhost:8765/ws ─▶ Python sign service
                                   ◀─tokens──                           (segment → features → model)
  tokens ─▶ /api/sentence (Gemma) ─▶ German text ─▶ /api/tts (ElevenLabs) ─▶ "tts" audio track ──┐
  captions ◀─ Scribe realtime (ElevenLabs) ◀─ callee audio track ◀──────────────────────────────┤
                                                                     LiveKit Cloud room "praxis-demo"
CALLEE (phone or 2nd laptop) — https://<ngrok-domain>/callee: mic on, hears the "tts" track ──────┘
```

- The signer does **not** publish a microphone. They publish only the `tts` track, which avoids echo.
- Video never leaves the browser. Only landmark numbers go to the local Python service.

## 4. Repo layout

```
magde-hack/
├─ .env                         local only, never committed (already exists)
├─ .gitignore
├─ plan.md
├─ web/                         Next.js + TypeScript
│  ├─ .env -> ../.env           symlink (Next.js loads .env from its own folder)
│  ├─ next.config.ts            F0
│  ├─ app/
│  │  ├─ page.tsx               F9  signer app (2 columns + dial bar)
│  │  ├─ callee/page.tsx        F1  other party (doctor / practice)
│  │  ├─ record/page.tsx        F6  sign recording + debug page
│  │  └─ api/
│  │     ├─ livekit-token/route.ts   F1
│  │     ├─ scribe-token/route.ts    F2
│  │     ├─ tts/route.ts             F3
│  │     └─ sentence/route.ts        F4
│  ├─ components/
│  │  ├─ SignCamera.tsx         F5  webcam + MediaPipe + overlay + WebSocket client
│  │  ├─ Captions.tsx           F9
│  │  └─ DialBar.tsx            F9
│  └─ lib/
│     ├─ contract.ts            F0  shared types + constants (§6)
│     ├─ labels.json            F0  sign vocabulary (read by TS and Python)
│     ├─ call.ts                F1 + F3  LiveKit join/leave + voice track
│     └─ stt.ts                 F2  remote audio → Scribe → captions
└─ sign/                        Python sign service
   ├─ requirements.txt
   ├─ core.py                   F6/F7  features, segmenter, model definition
   ├─ server.py                 F6/F8  FastAPI WebSocket: record + infer, GET /health
   ├─ train.py                  F7  train, evaluate, export
   ├─ data/<LABEL>/*.json       F6  recorded samples (committed, small JSON)
   └─ models/                   F7  model.pt, config.json
```

**Lanes.** The single boundary between them is the token, so there is exactly one cross-lane touchpoint.
- **Lane A** (person 1 + agent): F1, F2, F3, F4, F9. Covers token → voice, the call, captions and UI.
- **Lane B** (person 2 + agent): F5, F6, F7, F8. Covers camera → token.

## 5. Environment

Already in `.env` (names only): `ELEVEN_LABS_API_KEY`, `OPENROUTER_API_KEY`, `LLM_MODEL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NGROK_AUTH_TOKEN`.

Add:
- `ELEVEN_LABS_VOICE_ID`: a voice from the ElevenLabs voice library. Any voice works with `eleven_flash_v2_5` in German.
- Optional `LIVEKIT_ROOM`: default `praxis-demo`. Use a different value per laptop while testing, so two developers don't end up in the same room.
- Optional `NEXT_PUBLIC_SIGN_WS_URL`: default `ws://localhost:8765/ws`.

Notes:
- `LLM_MODEL` must be `google/gemma-4-31b-it`.
- Our ElevenLabs key name differs from the SDK default (`ELEVENLABS_API_KEY`). Always pass it explicitly: `new ElevenLabsClient({ apiKey: process.env.ELEVEN_LABS_API_KEY })`.
- Keys are used only in API routes. The browser gets only short-lived tokens (LiveKit JWT, Scribe single-use token).
- The Python service needs no keys.
- ngrok allows **one agent session per auth token**. Only the person testing the phone runs it.

## 6. Data contracts (fixed; change only on `main` and tell the other lane)

### 6.1 Vocabulary: `web/lib/labels.json`

```json
{
  "p0": ["HALLO", "DANKE", "TSCHUESS", "JA", "NEIN", "WIEDERHOLEN", "NAME",
         "TERMIN", "WOLLEN", "HEUTE", "MORGEN", "NACHMITTAG", "UHR",
         "UNTERSUCHUNG", "SCHMERZ"],
  "p1": ["VORMITTAG", "ABEND", "ZEIT", "ABSAGEN", "KOPF", "BAUCH", "FIEBER",
         "EINS", "ZWEI", "DREI", "VIER", "FUENF", "SECHS",
         "SIEBEN", "ACHT", "NEUN", "ZEHN", "ELF", "ZWOELF"],
  "none": "_NONE"
}
```

- Build and record **p0** first.
- `_NONE` = non-sign movement. It is trained, but never emitted.
- `"?"` = a sign was detected but rejected as uncertain. It is emitted by the service and is not a model class.
- Python reads this same file (`../web/lib/labels.json`).

### 6.2 Shared TS types: `web/lib/contract.ts`

```ts
export const ROOM_NAME = process.env.LIVEKIT_ROOM ?? "praxis-demo"; // server-side only
export const IDENTITY = { signer: "signer", callee: "callee" } as const;
export const TTS_TRACK_NAME = "tts";
export const MOCK_CONTACTS = [            // fictional, display only — both join ROOM_NAME
  { name: "Hausarztpraxis Dr. Weber", number: "+49 391 0000 001" },
  { name: "Praxis Dr. Schmidt",       number: "+49 391 0000 002" },
];
export const SIGN_WS_URL = process.env.NEXT_PUBLIC_SIGN_WS_URL ?? "ws://localhost:8765/ws";

export type Token = {
  label: string;                  // from labels.json or "?"
  conf: number;
  t: number;
  top?: [string, number][];
  question?: "yn" | "wh";         // DGS brows during the sign: raised = yes/no question, lowered = W-question
  negation?: boolean;             // head shake during the sign
};
export type Turn = { who: "me" | "them"; text: string };
export type Caption = { id: string; who: "me" | "them"; text: string; final: boolean; gloss?: string[] };
export type SignStatus = { state: "rest" | "signing"; fps: number; online: boolean };

export type SignCameraProps = {             // F5 → F9 (the only cross-lane interface)
  mode: "infer" | "record";
  recordLabel?: string;
  signer?: string;
  onToken?: (t: Token) => void;
  onStatus?: (s: SignStatus) => void;
  onRecorded?: (label: string, count: number) => void;
};
```

### 6.3 WebSocket protocol: browser ↔ sign service (`ws://localhost:8765/ws`, JSON text)

Browser → service:
```jsonc
{"type":"frame","t":1731580000123,"w":1280,"h":720,
 "hands":[{"handedness":"Left","score":0.97,"lm":[[0.5123,0.6341,-0.0121], /* 21 points */]}],
 "pose":[[0.5011,0.3122,-0.2100,0.99], /* 33 points: x,y,z,visibility */]}   // pose may be null
{"type":"mode","mode":"infer"}
{"type":"mode","mode":"record","label":"TERMIN","signer":"aditya"}
{"type":"reset"}
```
- Coordinates are MediaPipe normalised image coordinates (0–1) of the **non-mirrored** frame, rounded to 4 decimals.
- `t` is in milliseconds and must strictly increase. About 30 frames per second; `hands` may be `[]`.

Service → browser:
```jsonc
{"type":"status","state":"rest","mode":"infer","fps":29.6}          // on change + every 1 s
{"type":"token","label":"TERMIN","conf":0.91,"t":1731580000500,
 "top":[["TERMIN",0.91],["MORGEN",0.05],["ZEIT",0.02]],
 "question":"yn","negation":false}                                   // question/negation optional
{"type":"recorded","label":"TERMIN","count":12}
{"type":"error","message":"model not loaded"}
```
`GET http://localhost:8765/health` → `{"ok":true,"model":true,"labels":[...],"counts":{"HALLO":15}}`

### 6.4 Recorded sample: `sign/data/<LABEL>/<signer>_<unix_ms>.json`

```json
{"label":"TERMIN","signer":"aditya","w":1280,"h":720,"frames":[{"t":0,"hands":[],"pose":[]}]}
```
Store **raw frames** (including pre/post padding), not features. Features can then change later without re-recording.

### 6.5 Model artifacts: `sign/models/`

- `config.json`: `{"arch":"cnn1d"|"knn","labels":[...],"seq_len":32,"feat_dim":140,"mean":[...],"std":[...],"threshold":0.6,"margin":0.2}`
- `model.pt` (cnn1d state dict) or `knn.npz` (templates + labels)

### 6.6 HTTP API routes (Next.js)

| Route | Request | Response |
|---|---|---|
| `GET /api/livekit-token?identity=signer\|callee` | – | `{ "token": "...", "url": "wss://..." }` |
| `GET /api/scribe-token` | – | `{ "token": "..." }` |
| `POST /api/tts` | `{ "text": "Guten Tag ..." }` | `audio/mpeg` bytes |
| `POST /api/sentence` | `{ "tokens": ["HALLO","TERMIN","WOLLEN","MORGEN","NACHMITTAG"], "history": Turn[], "profile": { "name": "Aditya" }, "question": null, "negation": false }` (`question`: `"yn"`, `"wh"` or `null`) | `{ "text": "Guten Tag, ich möchte gerne einen Termin für morgen Nachmittag vereinbaren." }` |

### 6.7 Web module interfaces (inside Lane A)

```ts
// lib/call.ts
joinCall(identity: "signer" | "callee", on: {
  onRemoteAudio(track: MediaStreamTrack): void;  // callee's voice (signer side) / tts (callee side)
  onPeer(state: "joined" | "left"): void;
  onEnd(): void;
}): Promise<{ room: Room; leave(): Promise<void> }>
createVoice(room: Room): Promise<{ speak(text: string): Promise<void>; stop(): void }>   // F3

// lib/stt.ts
startCaptions(track: MediaStreamTrack, on: { onPartial(text: string): void; onFinal(text: string): void }): Promise<() => void>
```

---

## 7. Functionalities

Each functionality is built and tested on its own. Mocks replace other functionalities until they are merged.

### F0 Setup · `main` · one person, before everything else

1. Initialise git (do this before `create-next-app`):
   ```bash
   git init && git branch -M main && git remote add origin https://github.com/DarshanScripts/magde-hack.git
   ```
2. Create the Next.js app:
   ```bash
   npx create-next-app@latest web --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --disable-git --yes
   ```
3. Install **all** npm packages now, so lanes never edit `package.json`:
   ```bash
   cd web && npm i livekit-client livekit-server-sdk @elevenlabs/client @elevenlabs/elevenlabs-js @mediapipe/tasks-vision
   ```
4. Link the env file: `ln -s ../.env web/.env`.
5. Allow ngrok domains in `web/next.config.ts`:
   ```ts
   allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app"]
   ```
6. Create `web/lib/contract.ts` and `web/lib/labels.json` exactly as in §6.
7. Set up Python:
   ```bash
   cd sign && python3.11 -m venv .venv && . .venv/bin/activate && pip install fastapi "uvicorn[standard]" numpy scikit-learn
   ```
   Add torch as described in F7 and write `requirements.txt`.
8. Register ngrok once on the machine that will run it: `ngrok config add-authtoken <NGROK_AUTH_TOKEN value>`.
9. Commit and push `main`. **Check that `.env` is not in `git status`.**

Done when: `npm run dev` serves the default page, `python -c "import fastapi, numpy"` works, and `main` is pushed without `.env`.

### F1 Call (LiveKit) · `feat/call` · Lane A

1. `api/livekit-token/route.ts`:
   ```ts
   new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity })
   addGrant({ room: ROOM_NAME, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true })
   await at.toJwt()
   ```
   Return `{ token, url: LIVEKIT_URL }`.
2. `lib/call.ts` `joinCall()`:
   - Create `new Room({ adaptiveStream: true, dynacast: true })` and `connect(url, token)`.
   - On `RoomEvent.TrackSubscribed` with an audio track: `track.attach()`, append the element, call `onRemoteAudio(track.mediaStreamTrack)`.
   - Map `ParticipantConnected`/`ParticipantDisconnected` → `onPeer`, and `Disconnected` → `onEnd`.
3. `callee/page.tsx`:
   - "Beitreten" button (a user tap is required for mic permission and audio autoplay on phones; call `room.startAudio()`).
   - On tap: `joinCall("callee")` + `setMicrophoneEnabled(true)`.
   - Show status ("Warte auf Anruf…" / "Verbunden"), a mute button, and play remote audio.
4. Test harness on the signer page: a temporary "Join" button calling `joinCall("signer")`. The signer publishes no microphone.
5. Local testing: two tabs (`/` and `/callee`) with headphones. Phone test: `ngrok http 3000` → open `https://<domain>/callee`.

Done when: the callee speaks and the signer tab hears it; "Auflegen" disconnects both sides cleanly; the callee shows "Verbunden" when the signer joins.

### F2 Live captions (Scribe realtime) · `feat/captions` · Lane A

1. `api/scribe-token/route.ts`: `elevenlabs.tokens.singleUse.create("realtime_scribe")` → `{ token }`. The token is single-use and expires after 15 min, so fetch a new one for every (re)connect.
2. `lib/stt.ts` `startCaptions(track)`:
   ```ts
   Scribe.connect({ token, modelId: "scribe_v3_live", audioFormat: AudioFormat.PCM_16000, sampleRate: 16000,
                    commitStrategy: CommitStrategy.VAD, languageCode: "de" })
   ```
   Audio path: `new MediaStream([track])` → `AudioContext.createMediaStreamSource` → AudioWorklet → downsample to 16 kHz mono Int16 → base64 → `connection.send({ audioBase64 })` every ~100 ms.
   - `PARTIAL_TRANSCRIPT` → `onPartial`; `COMMITTED_TRANSCRIPT` → `onFinal`.
   - Reconnect on close.
3. Chrome quirk: a remote WebRTC stream only flows into Web Audio if it is also attached to an `<audio>` element. F1 already does this.
4. Test first with Scribe's `microphone` option (local mic, no call), then switch the source to the remote track.

Done when: German speech from the callee appears as live partial text within ~1 s and becomes a final caption when they pause.

### F3 Voice out (TTS into the call) · `feat/voice` · Lane A

1. `api/tts/route.ts`:
   ```ts
   textToSpeech.convert(ELEVEN_LABS_VOICE_ID, { text, modelId: "eleven_flash_v2_5", outputFormat: "mp3_44100_128", languageCode: "de" })
   ```
   Stream the result back as `audio/mpeg`.
2. `lib/call.ts` `createVoice(room)`:
   - Create one `AudioContext` and one `MediaStreamAudioDestinationNode`, and publish that destination **once**:
     ```ts
     room.localParticipant.publishTrack(dest.stream.getAudioTracks()[0], { name: "tts", source: Track.Source.Microphone })
     ```
   - `speak(text)`: fetch `/api/tts` → `decodeAudioData` → `AudioBufferSourceNode` → `dest`. Queue utterances; the promise resolves when playback ends.
   - Optional local monitor (also connect to `ctx.destination`), off by default.
3. Create or resume the `AudioContext` inside a click handler ("Anrufen"), because browsers block audio autoplay.
4. Test harness: a text field + "Sagen" button on the signer page.

Done when: text typed on the signer page is heard in German on the callee device within ~1.5 s, several times in a row.

### F4 Sentence generation (Gemma 4 31B) · `feat/sentence` · Lane A

1. `api/sentence/route.ts` → `POST https://openrouter.ai/api/v1/chat/completions` with header `Authorization: Bearer OPENROUTER_API_KEY` and body:
   ```json
   {"model": "<LLM_MODEL>", "temperature": 0.2, "max_tokens": 120,
    "reasoning": {"enabled": false}, "response_format": {"type": "json_object"}, "messages": [...]}
   ```
   - Send the last 6 turns of history.
   - Timeout 4 s → fallback: join the tokens into a simple sentence.
   - Drop `"?"` tokens before sending.
2. System prompt (use as-is):
   ```
   You turn DGS (German Sign Language) gloss tokens from a deaf caller into ONE spoken German sentence
   for a phone call with a medical practice. Answer in German.
   Rules:
   1. Tokens are DGS glosses: topic/time first, verb last, no articles.
   2. Output one short, natural, polite sentence (Sie-Form), as the caller would say it.
   3. Use the history to resolve JA/NEIN and references ("Passt Ihnen 15 Uhr?" + JA → "Ja, 15 Uhr passt mir gut.").
   4. Never add facts that are not in the tokens or the history: no invented times, dates, names or symptoms.
   5. NAME → "Mein Name ist {profile.name}."  WIEDERHOLEN → "Entschuldigung, können Sie das bitte wiederholen?"
   6. Number + UHR (+ VORMITTAG/NACHMITTAG/ABEND) → a clock time ("NEUN UHR ABEND" → "21 Uhr").
   7. Never give medical advice. Only express what the caller signed.
   8. question = "yn" → phrase it as a yes/no question ("MORGEN NACHMITTAG" → "Geht es morgen Nachmittag?").
      question = "wh" → phrase it as a W-question (wann/was/wo/wer/wie). negation = true → negate the statement ("HEUTE" → "Heute geht es nicht.").
   Return JSON: {"text": "<German sentence>"}
   ```
3. Test cases (run with curl):

| tokens | history (last "them") | expected meaning |
|---|---|---|
| HALLO TERMIN WOLLEN MORGEN NACHMITTAG | – | "Guten Tag, ich möchte gerne einen Termin für morgen Nachmittag vereinbaren." |
| UNTERSUCHUNG TERMIN WOLLEN | – | wants a check-up appointment |
| KOPF SCHMERZ | "Worum geht es?" | "Ich habe Kopfschmerzen." |
| JA | "Passt Ihnen morgen um 15 Uhr?" | "Ja, morgen um 15 Uhr passt mir." |
| NEIN NACHMITTAG | "Geht es um 9 Uhr?" | declines, asks for the afternoon |
| TERMIN ABSAGEN HEUTE | – | cancels today's appointment |
| NAME | "Wie ist Ihr Name?" | "Mein Name ist Aditya." |
| WIEDERHOLEN | any | asks to repeat |
| DANKE TSCHUESS | – | "Vielen Dank, auf Wiederhören!" |

Done when: all 9 cases give a correct, natural sentence with no invented facts, each in under ~2 s.

### F5 Sign camera (MediaPipe in the browser) · `feat/sign-camera` · Lane B

1. `components/SignCamera.tsx`: client-only (`"use client"`, load it with `next/dynamic` and `ssr: false`). Props are `SignCameraProps` (§6.2).
2. `getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 } })`. Fall back to 640×480 if fps stays below 20.
3. Load MediaPipe models:
   - `FilesetResolver.forVisionTasks(<jsDelivr wasm URL pinned to the installed @mediapipe/tasks-vision version>)`
   - `HandLandmarker`: `numHands: 2`, `runningMode: "VIDEO"`, `delegate: "GPU"`, model `hand_landmarker.task`
   - `PoseLandmarker`: lite model, `"VIDEO"`, `"GPU"`, `numPoses: 1`
4. Loop with `requestVideoFrameCallback`:
   - Call `detectForVideo(video, ts)` with strictly increasing `ts`.
   - Skip a frame if the previous one is still being processed.
5. Mirror the **display only** (CSS `scaleX(-1)` on the video and overlay). MediaPipe and the service always get raw, non-mirrored coordinates.
6. Overlay with `DrawingUtils`: hand connections plus shoulders, elbows and wrists. Show an FPS badge in the corner.
7. WebSocket to `SIGN_WS_URL`:
   - Send frame messages (§6.3) only while `ws.bufferedAmount < 64 KB`.
   - Send a `mode` message whenever props change.
   - Auto-reconnect every 1 s; when disconnected, call `onStatus({ online: false })` and show an offline badge.
8. If tracking is slow, open `chrome://gpu` and check that WebGL2 is hardware accelerated. Otherwise use `delegate: "CPU"`.

Done when: `/record` shows landmarks at ≥ 25 fps and the service reports `fps` ≈ 30.

### F6 Sign service: segmentation + recording · `feat/sign-service` · Lane B

1. Run with `uvicorn server:app --port 8765` from `sign/`. Each WebSocket connection gets its own state: mode, segmenter, ring buffer.
2. Segmenter (`core.py`):
   - Speeds are measured in shoulder widths per second, using the dominant wrist.
   - **Start:** speed > 0.5 for 3 consecutive frames.
   - **End:** speed < 0.25 for 350 ms, or no hands for 300 ms.
   - Add 5 frames of pre-roll from the ring buffer and 3 frames of post-roll.
   - Discard segments shorter than 0.25 s; force a cut at 3 s.
   - All constants live at the top of `core.py`.
3. Record mode: on each segment end, save a sample (§6.4) and reply `recorded` with the new count.
4. Send `status` messages on rest/signing changes and every second (with fps).
5. `GET /health` returns sample counts per label.
6. `record/page.tsx` (Lane B):
   - Left: `<SignCamera>`.
   - Right: record/infer toggle, signer name, label dropdown (from `labels.json`), a big counter, a counts list (`/health`), and the last prediction with its top 3 (infer mode).

Done when: in record mode, 5× HALLO creates 5 files of 8–90 frames each, and no files appear while the hands rest.

### F7 Data + training · `feat/sign-training` · Lane B

**Recording protocol**
- Use the same seat, lighting, camera and distance as the demo. Upper body visible.
- Learn each sign from a DGS dictionary video and keep **one** variant per sign.
- Between signs, pause about 0.5 s or lower the hands.
- Record **15 per p0 label** from signer 1, with natural variation in speed and position.
- Record **30× `_NONE`**: scratching, touching glasses, reaching for the mouse, random waving.
- If a second person can sign: 5 per label as the hold-out set. Otherwise hold out the last 3 samples per label.

**Features** (`core.py`: `features(frames, w, h) -> np.ndarray[T, 140]`)
1. Correct the aspect ratio: `x *= w / h`. Smooth raw points with a 3-frame moving average. Linearly interpolate hand gaps of ≤ 3 frames.
2. Assign hands by the nearest pose wrist (pose 15 = signer's left, 16 = signer's right). **Don't trust `handedness`.** The signer's right hand is the dominant hand.
3. Handshape: 21 points minus the wrist, divided by the distance wrist → middle-finger knuckle (point 9). Multiply z by 0.5. → 63 values per hand.
4. Location: wrist relative to the shoulder midpoint ÷ shoulder width (2), and relative to the nose (2), per hand.
5. Velocity: change in location per frame (2 per hand). Presence flag (1 per hand). A missing hand → zeros.
6. Resample to 32 frames by linear interpolation in time. Standardise with the train mean/std (stored in `config.json`).

**Augmentation** (training only)
- Time stretch 0.8–1.2 and shift ±3 frames.
- Scale ±10 %, rotate ±10°, translate ±5 %.
- Noise σ 0.01; drop the non-dominant hand in 5 % of samples.
- **No** left/right mirroring (it changes meaning in DGS).

**Models** (both get the same features)
- Baseline: 1-nearest-neighbour on the flattened 32×140 sequence. Takes seconds.
- Main: 1D-CNN:
  ```
  Linear(140→128) → 3× [Conv1d k=5 → BatchNorm → GELU → Dropout 0.2] → global avg+max pool → Linear(→ classes)
  ```
  AdamW (lr 1e-3), label smoothing 0.1, 150–300 epochs, batch 64.
- Ship whichever scores higher on the hold-out set (`arch` in `config.json`).
- Rejection: choose `threshold` (top-1 probability) and `margin` (top-1 minus top-2) on the hold-out set, so that wrong predictions become `"?"` while ≥ 90 % of correct ones pass.

**PyTorch on the GTX 1050** (Pascal, sm_61): CUDA 12.8+/13 wheels dropped Pascal, and 2.14 is the last release with cu126 wheels.
```bash
pip install "torch<2.15" --index-url https://download.pytorch.org/whl/cu126
```
The CPU wheel is also fine: the model is tiny and trains in seconds to minutes either way.

**`python train.py`** prints per-label accuracy, the top confusion pairs and the chosen threshold/margin, and writes `models/`.

Done when: hold-out accuracy on p0 is ≥ 85 % and `models/config.json` plus the model file exist.

### F8 Live recognition · `feat/sign-live` · Lane B

1. `server.py` loads `models/` at startup, and again on each new WebSocket connection if the files changed. After retraining, just reload the page.
2. On segment end in infer mode: features → model → probabilities.
   - Emit `token` with `top` (3 entries).
   - Emit `"?"` if the result is `_NONE`, below `threshold`, or below `margin`.
   - Drop repeats of the same label within 400 ms.
3. Compute budget: under 50 ms per segment.

Done when: on `/record` in infer mode, each p0 sign shows the correct label ≤ 0.3 s after the hands stop, and resting or random movement produces no tokens.

### F9 Main page + conversation loop · `feat/ui` · Lane A

1. Layout (`app/page.tsx`, `Captions.tsx`, `DialBar.tsx`):
   - **Left (~55 %):** `<SignCamera mode="infer" onToken onStatus />` with landmarks, the token chips below it, and a status dot (grey = rest, red = signing, crossed = sign service offline).
   - **Right (~45 %):** caption feed. "Them" bubbles on the left (grey); "me" bubbles on the right (blue), each with a small gloss line (`HALLO · TERMIN · …`). The live partial caption sits at the bottom. Auto-scroll; font ≥ 20 px.
   - **Bottom bar:** before the call, a dropdown with the 2 `MOCK_CONTACTS` + "Anrufen". During the call, the contact name, a timer and a red "Auflegen". Both contacts join `ROOM_NAME`.
2. Loop:
   1. `onToken` → append a chip. `"?"` shows as a grey chip and is not sent.
   2. 1.5 s after the last token (or on Enter) → `POST /api/sentence` with the tokens, the last 6 turns and the profile.
      Utterance flags from the tokens: `question` = the last non-empty `question` among the tokens (else `null`); `negation` = any token has `negation`.
      Show them on the chips (e.g. "?" / "¬" badge) so the signer sees what was detected.
   3. Add caption `{ who: "me", text, gloss }` → `voice.speak(text)` → push `Turn { who: "me" }` → clear the chips.
   4. Backspace removes the last chip; Esc clears all chips.
   5. `startCaptions(remoteTrack)`: `onPartial` → live line; `onFinal` → caption + `Turn { who: "them" }`.
3. Profile name field (used by `NAME`), stored in `localStorage`.
4. Optional confirm mode toggle: show the sentence first; Enter speaks it, Esc discards it.
5. Mocks:
   - `/?mock=1` shows buttons for every label in `labels.json`. They call the same `onToken`, so the whole loop runs without a camera or Python.
   - Until F5 is merged, the left column shows a placeholder.

Done when, with `?mock=1`:
- HALLO TERMIN WOLLEN MORGEN NACHMITTAG → a German sentence appears in the feed and is heard on the callee device.
- The callee's reply appears as live captions.
- "Auflegen" brings back the dial bar.

### F10 Integration + demo run · `main` · both lanes

1. Merge order: F1 → F2 → F3 → F4 → F9 (with mocks) → F5 → F6/F7/F8 → swap the placeholder for `<SignCamera>`.
2. Demo machine: Lane B's laptop (GTX 1050, data, model). Three terminals:
   ```bash
   cd sign && . .venv/bin/activate && uvicorn server:app --port 8765
   cd web && npm run dev        # or: npm run build && npm start
   ngrok http 3000
   ```
3. Open the pages:
   - The signer opens **`http://localhost:3000`**, not the ngrok URL. An https page cannot reach `ws://localhost:8765`.
   - The callee opens `https://<ngrok-domain>/callee` on a phone or second laptop and taps "Beitreten".
4. Run the acceptance test (§9). Fix issues, then feature freeze. Record a backup screen video of one successful run.

## 8. Order (two lanes in parallel)

| Step | Lane A: call, voice, sentence, UI | Lane B: signs |
|---|---|---|
| 0 | F0 setup → push `main` | learn the p0 signs, set up Python + torch |
| 1 | F1 Call | F5 Sign camera |
| 2 | F2 Captions + F3 Voice | F6 Segmentation + recording |
| 3 | F4 Sentence | F7 Record data + train |
| 4 | F9 Main page (mock tokens) | F8 Live recognition |
| 5 | F10 Integration (both) | F10 Integration (both) |

Cross-lane touchpoints: only the F0 contract files, and F9 importing `SignCamera`.

## 9. Acceptance test (end to end)

| # | Who | Input | Expected |
|---|---|---|---|
| 1 | Callee says | "Praxis Dr. Weber, guten Tag." | caption (them) |
| 2 | Signer signs | HALLO TERMIN WOLLEN MORGEN NACHMITTAG | "Guten Tag, ich möchte gerne einen Termin für morgen Nachmittag vereinbaren." is spoken |
| 3 | Callee | "Worum geht es denn?" | caption |
| 4 | Signer | UNTERSUCHUNG KOPF SCHMERZ | "Ich möchte eine Untersuchung, ich habe Kopfschmerzen." |
| 5 | Callee | "Passt Ihnen morgen um 15 Uhr? Wie ist Ihr Name?" | caption |
| 6 | Signer | JA NAME | "Ja, 15 Uhr passt mir. Mein Name ist <profile name>." |
| 7 | Callee | "Gut, dann bis morgen!" | caption |
| 8 | Signer | DANKE TSCHUESS | "Vielen Dank, auf Wiederhören!" |

Targets:
- End of sign → chip ≤ 0.5 s.
- Last chip → voice starts ≤ 3 s.
- Callee speaks → partial caption ≤ 1 s.

## 10. Rules for both agents

- Read this file before coding. Work only on your functionality's branch and files (§4).
- The contract (§6) is fixed. If it must change, make one small commit on `main` and tell the other lane.
- Don't add npm packages (F0 installs all of them). Python packages go into `sign/requirements.txt`.
- Never print, log or commit `.env` values. Secrets stay in API routes; the browser gets only short-lived tokens.
- Keep it small: plain functions, few files, no state libraries, no extra frameworks.
- A functionality is done only when its "Done when" check passes locally. Then merge it to `main`.

## 11. Limits and cut list

**Known limits** (say these in the pitch):
- About 15–35 fixed signs.
- Short pauses between signs.
- Trained on 1–2 signers.
- No facial grammar: questions, which DGS marks with the eyebrows, are inferred from context by the LLM.
- Relays communication only; no medical advice.

**If short on time, cut in this order:**
1. p1 labels (numbers etc.) → p0 only. The callee proposes times and the signer answers JA/NEIN.
2. 1D-CNN → ship the 1-NN baseline.
3. Confirm mode, optional UI polish.
4. LiveKit path broken → speakerphone fallback: a normal phone call on speaker next to the laptop, Scribe in `microphone` mode, TTS played on the laptop speakers.

**Only after §9 passes:**
- Eyebrow raise via FaceLandmarker → question flag on tokens.
- Finger spelling (Kaggle DGS alphabet, CC BY-SA 4.0).
- Signer video to the callee.
- Captions on the callee page via the LiveKit data channel.
