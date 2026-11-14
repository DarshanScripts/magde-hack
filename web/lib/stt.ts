import { AudioFormat, CommitStrategy, RealtimeEvents, Scribe } from "@elevenlabs/client";
import { audioContext } from "./call";

const CHUNK_MS = 100;
const MAX_RETRIES = 5;

// Runs on the audio thread: mono Float32 in, PCM16 chunks out. `step` averages neighbouring samples (48 kHz -> 16 kHz).
const WORKLET = `
registerProcessor("pcm16-chunks", class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.step = options.processorOptions.step;
    this.out = new Int16Array(options.processorOptions.chunkSamples);
    this.filled = 0;
    this.sum = 0;
    this.count = 0;
  }
  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      if (++this.count < this.step) continue;
      const sample = Math.max(-1, Math.min(1, this.sum / this.step));
      this.sum = 0;
      this.count = 0;
      this.out[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.filled === this.out.length) {
        this.port.postMessage(this.out.slice().buffer);
        this.filled = 0;
      }
    }
    return true;
  }
});`;

const FORMATS: Record<number, AudioFormat> = {
  16000: AudioFormat.PCM_16000,
  22050: AudioFormat.PCM_22050,
  24000: AudioFormat.PCM_24000,
  44100: AudioFormat.PCM_44100,
  48000: AudioFormat.PCM_48000,
};

let workletReady: Promise<void> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export type CaptionState = "connecting" | "live" | "failed";

// Transcribes a (remote) audio track live. Resolves to a stop function.
export async function startCaptions(
  track: MediaStreamTrack,
  on: { onPartial(text: string): void; onFinal(text: string): void; onState?(state: CaptionState): void },
): Promise<() => void> {
  const ac = audioContext();
  const step = ac.sampleRate % 16000 === 0 ? ac.sampleRate / 16000 : 1;
  const sampleRate = ac.sampleRate / step;
  const audioFormat = FORMATS[sampleRate];
  if (!audioFormat) throw new Error(`unsupported sample rate ${ac.sampleRate}`);

  workletReady ??= ac.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
  await workletReady;

  const source = ac.createMediaStreamSource(new MediaStream([track]));
  const node = new AudioWorkletNode(ac, "pcm16-chunks", {
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
    processorOptions: { step, chunkSamples: Math.round((sampleRate * CHUNK_MS) / 1000) },
  });
  source.connect(node);

  let stopped = false;
  let open = false;
  let retries = 0;
  let connection: ReturnType<typeof Scribe.connect> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    if (open) connection?.send({ audioBase64: toBase64(event.data) });
  };

  async function connect() {
    on.onState?.("connecting");
    try {
      const res = await fetch("/api/scribe-token", { cache: "no-store" });
      if (!res.ok) throw new Error("scribe token request failed");
      const { token } = (await res.json()) as { token: string };
      if (stopped) return;

      const conn = Scribe.connect({
        token,
        modelId: "scribe_v3_live",
        audioFormat,
        sampleRate,
        commitStrategy: CommitStrategy.VAD,
        languageCode: "de",
      });
      connection = conn;
      conn.on(RealtimeEvents.SESSION_STARTED, () => {
        open = true;
        retries = 0;
        on.onState?.("live");
        console.info(`captions: live (${sampleRate} Hz)`);
      });
      conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (m) => {
        if (m.text.trim()) on.onPartial(m.text.trim());
      });
      conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (m) => {
        if (m.text.trim()) on.onFinal(m.text.trim());
      });
      conn.on(RealtimeEvents.ERROR, (e) => console.error("captions:", e));
      conn.on(RealtimeEvents.CLOSE, () => {
        if (connection !== conn) return;
        open = false;
        retry();
      });
    } catch (err) {
      console.error("captions:", err);
      retry();
    }
  }

  function retry() {
    if (stopped) return;
    if (retries >= MAX_RETRIES) return on.onState?.("failed");
    retryTimer = setTimeout(connect, 500 * 2 ** retries++);
  }

  await connect();

  return () => {
    stopped = true;
    open = false;
    clearTimeout(retryTimer);
    source.disconnect();
    node.port.onmessage = null;
    connection?.close();
  };
}
