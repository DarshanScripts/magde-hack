# Real-time speech: from batch-per-sentence to streaming (Lane A)

Goal: the callee hears the signer's words about 1 s after the last sign, and while the signer keeps
signing, earlier parts are already being spoken. It should feel like a live conversation, not
"sign, wait 4 s, hear a sentence".

## Where the time goes today (`origin/develop`)

After the last sign, `web/app/page.tsx` does everything one step after the other:

| Step | Time |
|---|---|
| Sign service: sign recognised → token over WebSocket | ~0.15 s (already streaming, one token per sign) |
| `SENTENCE_DELAY_MS` silence timer | 2.5 s |
| `/api/sentence` (LLM) | ~0.5–1 s |
| `/api/tts`, then `res.arrayBuffer()` + `decodeAudioData` on the **whole** MP3 before playback | ~0.5–1 s |
| **Total from last sign to first audio** | **~3.5–4.5 s** |

The sign side is not the bottleneck. Lane B now also supports **continuous signing** (no hands-down
between signs; tokens arrive ~0.5–1 s apart), so a shorter pause no longer splits sentences.

## Changes (all in Lane A code; contract and sign service unchanged)

### 1. Speculative sentence + audio on every token (biggest win)
On every `addToken`, immediately start `/api/sentence` for the chips so far (abort the previous
request with an `AbortController`). When it returns and the chips are still the same, immediately
fetch `/api/tts` for that text and decode it to an `AudioBuffer`, but don't play it.
When the pause timer fires and the cached result belongs to exactly the current chips
(compare the gloss string + question + negation), play the cached buffer right away. Otherwise fall back
to the current path. Result: LLM + TTS happen *during* the pause, so the remaining wait is just the pause.
- Cost: ~1 extra LLM + TTS call per sign. Fine for a demo; abort stale requests to keep it bounded.
- `createVoice` in `web/lib/call.ts` needs a way to play a pre-decoded buffer:
  split `play(text)` into `prepare(text): Promise<AudioBuffer>` and `playBuffer(buf)`, keeping the
  existing queue/generation logic (`stop()` must still cancel).

### 2. Shorter pause: `SENTENCE_DELAY_MS` 2500 → 1200
With continuous signing, the gap between signs within one utterance is under 1 s. Make it an env/const
so we can tune it live (1000–1500 ms).

### 3. Speak in chunks, not whole sentences
Don't wait for the signer to finish a long utterance. Every time the pause timer fires, commit the
chips so far as one chunk and speak it. Clear chips and keep collecting. The voice queue already
plays chunks back to back, so chunk 2 is generated while chunk 1 is playing.
Pass the previous chunk in `history` (it already is, via captions) so the LLM keeps context
("TERMIN WOLLEN" → "Ich möchte einen Termin." then "MORGEN NACHMITTAG" → "Am besten morgen Nachmittag.").

### 4. Instant phrases
If the chips are exactly one self-contained sign, commit after 500 ms instead of the full pause:
`HALLO, DANKE, TSCHUESS, JA, NEIN, OKAY, WIEDERHOLEN, NAME`. With step 1, "Ja." is then heard about
0.5 s after signing JA. If another sign arrives within those 500 ms, fall back to the normal pause.

### 5. Optional: streaming playback
Play the MP3 while it downloads instead of after `arrayBuffer()`. Use `MediaSource` + `<audio>` →
`ac.createMediaElementSource` → `dest`, or ElevenLabs `outputFormat: "pcm_24000"` read chunk by chunk
into an `AudioWorklet`/scheduled `AudioBufferSourceNode`s. This only matters when the cache from
step 1 misses; do it last.

### Prompt change (`/api/sentence`)
Add a rule: "The input may be part of a longer utterance. Phrase only what the tokens say, as a short
natural fragment or sentence. Do not repeat what the history already says." Keep `max_tokens` small
(60) and the fast model.

## Expected result
Last sign → first audio: ~1.2 s (pause only, audio cached), single-sign answers ~0.5 s, long
utterances heard while still signing. Previously 3.5–4.5 s.

## Copy-paste prompt for person 1's coding agent
> In `web/app/page.tsx` and `web/lib/call.ts` (branch off `origin/develop`), make the signer's speech
> feel real-time, following `STREAMING_SPEECH.md`:
> (1) On every new token, speculatively call `/api/sentence` for the current chips (abort stale requests).
> When it returns for unchanged chips, prefetch and decode the TTS audio. Cache it keyed by
> gloss+question+negation. When the pause timer fires, play the cached buffer immediately if the key
> matches, else use the existing path. Split `createVoice().speak` into `prepare(text)` → AudioBuffer
> and `playBuffer(buf)`, keeping the queue/generation/stop semantics.
> (2) `SENTENCE_DELAY_MS` = 1200.
> (3) Each timer flush is one spoken chunk. Keep collecting the next chunk while the previous plays.
> (4) If the chips are one of HALLO/DANKE/TSCHUESS/JA/NEIN/OKAY/WIEDERHOLEN/NAME alone, flush after 500 ms.
> (5) Add the "may be part of a longer utterance" rule to the `/api/sentence` system prompt and lower
> `max_tokens` to 60.
> Keep confirm mode working: in confirm mode, show the cached text as the preview, and play the
> cached buffer on confirm. Keep `"?"` tokens excluded and the question/negation flags. Run
> `npx tsc --noEmit && npm run lint`. Test with `SIGN_FAKE=HALLO,TERMIN,WOLLEN,MORGEN,NACHMITTAG ./run.sh /`,
> then measure the time from the last chip to first audio on the callee (target ≤ 1.5 s).
