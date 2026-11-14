# Sign model v1: what changed and how to integrate (Lane A)

Branch: `origin/feat/sign-model-v1` (based on `feat/sign-integration`). Merges into `origin/develop` without conflicts.

## Integrate
```bash
git fetch origin
git checkout develop
git merge origin/feat/sign-model-v1
cd web && npx tsc --noEmit && npm run lint
./stop.sh && ./run.sh /        # restart: the sign service must reload code, labels and model
```
Nothing in your call/caption/voice code has to change for the merge itself.

## What's new
- **Model v1** (`sign/models/`): 33 words + `_NONE`. Accuracy is 82.5% (66/80) on a new recording session it never saw,
  mostly continuous signing. Up to 9 ms per sign on CPU. GPU is not needed.
- **New words** in `web/lib/labels.json` (p1): KOPF, BAUCH, FIEBER, VORMITTAG, ABEND, OKAY, NICHT, MOECHTEN,
  EINS–ZEHN. `ZEIT` was removed. `/api/sentence` reads its vocabulary from this file, so it accepts them automatically.
  Consider adding prompt examples: "OKAY NICHT" → "Das passt mir nicht.", "MORGEN DREI UHR" → "Morgen um 3 Uhr.",
  "KOPF SCHMERZ" → "Ich habe Kopfschmerzen.", "TERMIN MOECHTEN" → "Ich möchte einen Termin.".
- **Continuous signing**: the signer no longer has to lower the hands between signs. A short stop in the air (~½ s)
  is enough, and the token is sent at that moment. Tokens now arrive faster and closer together (~0.5–1 s apart).
- `"?"` still means uncertain or `_NONE` → keep excluding it from sentences.
- `contract.ts`: only one new **optional** prop `SignCameraProps.chain` (used by `/record`). Ignore it.

## Recommended in your code (real-time feel)
See `STREAMING_SPEECH.md`: speculative `/api/sentence` + TTS prefetch on every token, `SENTENCE_DELAY_MS` ≈ 1200,
speak in chunks, instant single-sign answers (JA/NEIN/HALLO/DANKE/OKAY…). With continuous signing, 2.5 s is
longer than needed.

## Test
1. `/record`, infer mode: sign a few words continuously (short stop in the air between signs). The chips should appear
   at each stop.
2. Main page call: `HALLO TERMIN MOECHTEN MORGEN DREI UHR` → one German sentence is spoken to the callee.
3. Do not merge into `main` until the full call works on the demo laptop.
