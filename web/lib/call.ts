import { AudioPresets, Room, RoomEvent, Track } from "livekit-client";
import { IDENTITY, TTS_TRACK_NAME } from "./contract";

type Identity = (typeof IDENTITY)[keyof typeof IDENTITY];

let ctx: AudioContext | null = null;

// One shared context. Call it inside a click/tap first, otherwise browsers keep it suspended.
export function audioContext(): AudioContext {
  if (!ctx || ctx.state === "closed") ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Turns a failed join into a sentence the person on the page can act on.
export function describeCallError(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Diese Adresse ist nicht sicher (kein HTTPS). Bitte die https-Adresse von ngrok oder localhost öffnen.";
  }
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError") return "Bitte erlauben Sie den Zugriff auf das Mikrofon.";
  if (name === "NotFoundError" || name === "NotReadableError") return "Es wurde kein nutzbares Mikrofon gefunden.";
  const detail = err instanceof Error ? err.message : String(err);
  return `Verbindung fehlgeschlagen: ${detail}`;
}

export async function joinCall(
  identity: Identity,
  on: {
    onRemoteAudio(track: MediaStreamTrack): void;
    onPeer(state: "joined" | "left"): void;
    onEnd(): void;
  },
): Promise<{ room: Room; leave(): Promise<void> }> {
  audioContext();
  const res = await fetch(`/api/livekit-token?identity=${identity}`, { cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "token request failed");
  const { token, url } = (await res.json()) as { token: string; url: string };

  const peer = identity === IDENTITY.signer ? IDENTITY.callee : IDENTITY.signer;
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const players = new Set<HTMLMediaElement>();

  room
    .on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      // Attaching to an <audio> element plays it, and Chrome needs it before Web Audio can read the track.
      const el = track.attach();
      el.hidden = true;
      document.body.appendChild(el);
      players.add(el);
      on.onRemoteAudio(track.mediaStreamTrack);
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    })
    .on(RoomEvent.ParticipantConnected, (p) => {
      if (p.identity === peer) on.onPeer("joined");
    })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      if (p.identity === peer) on.onPeer("left");
    })
    .on(RoomEvent.Disconnected, () => {
      players.forEach((el) => el.remove());
      players.clear();
      on.onEnd();
    });

  await room.connect(url, token);
  await room.startAudio().catch(() => {});
  for (const p of room.remoteParticipants.values()) {
    if (p.identity === peer) on.onPeer("joined");
  }

  return { room, leave: () => room.disconnect() };
}

export async function createVoice(
  room: Room,
): Promise<{ speak(text: string): Promise<void>; stop(): void }> {
  const ac = audioContext();
  const dest = ac.createMediaStreamDestination();
  await room.localParticipant.publishTrack(dest.stream.getAudioTracks()[0], {
    name: TTS_TRACK_NAME,
    source: Track.Source.Microphone,
    audioPreset: AudioPresets.speech,
    dtx: false, // keeps the first syllable after a long silence
  });

  let queue: Promise<void> = Promise.resolve();
  let generation = 0;
  let current: AudioBufferSourceNode | null = null;

  async function play(text: string, gen: number) {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "text-to-speech failed");
    const buffer = await ac.decodeAudioData(await res.arrayBuffer());
    if (gen !== generation) return;
    await new Promise<void>((resolve) => {
      const source = ac.createBufferSource();
      source.buffer = buffer;
      source.connect(dest);
      source.onended = () => {
        if (current === source) current = null;
        resolve();
      };
      current = source;
      source.start();
    });
  }

  return {
    speak(text) {
      const gen = generation;
      const done = queue.then(() => (gen === generation ? play(text, gen) : undefined));
      queue = done.catch(() => {});
      return done;
    },
    stop() {
      generation++;
      current?.stop();
    },
  };
}
