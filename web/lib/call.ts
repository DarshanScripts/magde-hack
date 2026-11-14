import { AudioPresets, ConnectionState, DisconnectReason, Room, RoomEvent, Track } from "livekit-client";
import { IDENTITY, TTS_TRACK_NAME } from "./contract";
import type { Translate } from "./i18n";

type Identity = (typeof IDENTITY)[keyof typeof IDENTITY];

let ctx: AudioContext | null = null;

// The shared context only feeds the call and the level meters, never the speakers, so it is not tied to a sound
// output device: with a stalled or missing device a normal AudioContext stands still and the voice never leaves the PC.
function newContext(): AudioContext {
  try {
    return new AudioContext({ sinkId: { type: "none" } } as AudioContextOptions);
  } catch {
    return new AudioContext();
  }
}

// One shared context. Call it inside a click/tap first, otherwise browsers keep it suspended.
export function audioContext(): AudioContext {
  if (!ctx || ctx.state === "closed") ctx = newContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// False when the computer's sound output does not accept audio. The browser then cannot play or decode the other
// side's voice either, so there is nothing to hear and nothing to caption.
export async function soundOutputWorks(): Promise<boolean> {
  const probe = new AudioContext();
  try {
    await probe.resume();
    await new Promise((resolve) => setTimeout(resolve, 800));
    return probe.state !== "running" || probe.currentTime > 0.2;
  } finally {
    void probe.close();
  }
}

// Turns a failed join into a sentence the person on the page can act on.
export function describeCallError(err: unknown, t: Translate): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return t("notSecure");
  }
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError") return t("micDenied");
  if (name === "NotFoundError" || name === "NotReadableError") return t("micMissing");
  return t("connectFailed", { detail: err instanceof Error ? err.message : String(err) });
}

export async function joinCall(
  identity: Identity,
  on: {
    onRemoteAudio(track: MediaStreamTrack): void;
    onPeer(state: "joined" | "left"): void;
    // "duplicate": another device joined with the same identity and LiveKit dropped this one.
    onEnd(reason: "duplicate" | "lost"): void;
  },
): Promise<{ room: Room; leave(): Promise<void> }> {
  audioContext();
  const res = await fetch(`/api/livekit-token?identity=${identity}`, { cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "token request failed");
  const { token, url } = (await res.json()) as { token: string; url: string };

  const peer = identity === IDENTITY.signer ? IDENTITY.callee : IDENTITY.signer;
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const players = new Set<HTMLMediaElement>();
  let peerSeen = false;
  const peerHere = () => [...room.remoteParticipants.values()].some((p) => p.identity === peer);

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
      if (p.identity === peer) {
        peerSeen = true;
        on.onPeer("joined");
      }
    })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      // A reconnect drops and re-adds everyone; the peer has only left if it is still gone afterwards.
      // LiveKit drops everyone first and only then switches to "reconnecting", so decide one tick later.
      if (p.identity !== peer) return;
      setTimeout(() => {
        if (room.state !== ConnectionState.Connected || peerHere()) return;
        peerSeen = false;
        on.onPeer("left");
      });
    })
    .on(RoomEvent.Reconnected, () => {
      const here = peerHere();
      if (here) on.onPeer("joined");
      else if (peerSeen) on.onPeer("left");
      peerSeen = here;
    })
    .on(RoomEvent.Disconnected, (reason) => {
      players.forEach((el) => el.remove());
      players.clear();
      on.onEnd(reason === DisconnectReason.DUPLICATE_IDENTITY ? "duplicate" : "lost");
    });

  await room.connect(url, token);
  await room.startAudio().catch(() => {});
  for (const p of room.remoteParticipants.values()) {
    if (p.identity === peer) {
      peerSeen = true;
      on.onPeer("joined");
    }
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
