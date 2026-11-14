"use client";

import { useEffect, useRef, useState } from "react";
import CallTimer from "@/components/CallTimer";
import LevelBars from "@/components/LevelBars";
import LatticeLoader from "@/components/reactbits/LatticeLoader";
import { HandIcon, HangUpIcon, MicIcon, MicOffIcon, PhoneIcon } from "@/components/icons";
import { joinCall } from "@/lib/call";
import { IDENTITY } from "@/lib/contract";

type Phase = "idle" | "connecting" | "waiting" | "connected";
type Call = Awaited<ReturnType<typeof joinCall>>;

export default function CalleePage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceTrack, setVoiceTrack] = useState<MediaStreamTrack | null>(null);
  const call = useRef<Call | null>(null);

  function reset(message: string | null) {
    call.current = null;
    setPhase("idle");
    setMuted(false);
    setVoiceTrack(null);
    setNotice(message);
  }

  function leave(message: string | null = null) {
    const current = call.current;
    reset(message);
    void current?.leave();
  }

  async function join() {
    setNotice(null);
    setPhase("connecting");
    try {
      const joined = await joinCall(IDENTITY.callee, {
        onRemoteAudio: setVoiceTrack,
        onPeer: (state) => {
          setPhase(state === "joined" ? "connected" : "waiting");
          if (state === "left") setVoiceTrack(null);
        },
        onEnd: () => {
          if (call.current) reset("Die Verbindung wurde getrennt.");
        },
      });
      call.current = joined;
      setPhase((p) => (p === "connecting" ? "waiting" : p));
      await joined.room.localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      console.error(err);
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      leave(denied ? "Bitte erlauben Sie den Zugriff auf das Mikrofon." : "Beitreten ist fehlgeschlagen.");
    }
  }

  async function toggleMute() {
    const next = !muted;
    setMuted(next);
    await call.current?.room.localParticipant.setMicrophoneEnabled(!next);
  }

  useEffect(() => () => void call.current?.leave(), []);

  const connected = phase === "connected";
  const live = phase !== "idle";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center gap-2.5 self-start">
        <span className="flex size-9 items-center justify-center rounded-xl bg-ink text-paper">
          <HandIcon width={18} height={18} />
        </span>
        <span className="text-lg font-semibold tracking-tight">DGS Call</span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 py-10 text-center">
        <div className="relative flex size-40 items-center justify-center">
          {phase === "waiting" ? (
            <>
              <span className="absolute inset-4 animate-ring rounded-full bg-accent/25" />
              <span className="absolute inset-4 animate-ring rounded-full bg-accent/25 [animation-delay:1.3s]" />
            </>
          ) : null}
          <span
            className={`relative flex size-32 items-center justify-center rounded-full border border-line shadow-card transition-colors duration-500 ${
              connected ? "bg-call-soft text-call" : "bg-surface text-ink"
            }`}
          >
            {connected ? <LevelBars track={voiceTrack} className="scale-[2.2]" /> : <PhoneIcon width={40} height={40} />}
          </span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
            {connected ? "Verbunden" : phase === "waiting" ? "Warte auf Anruf …" : "Anruf annehmen"}
          </h1>
          <div className="flex h-6 items-center text-base text-muted">
            {connected ? (
              <CallTimer />
            ) : phase === "connecting" ? (
              <LatticeLoader label="Verbinde" pattern="ripple" cellSize={3} gap={2} showTimer={false} color="var(--color-accent)" />
            ) : phase === "waiting" ? (
              "Sie sind bereit. Das Mikrofon ist an."
            ) : (
              "Praxis-Seite für eingehende Anrufe"
            )}
          </div>
        </div>

        <p className="max-w-xs rounded-3xl border border-line bg-surface px-5 py-4 text-left text-[15px] leading-relaxed text-muted shadow-card">
          Die anrufende Person gebärdet in Deutscher Gebärdensprache. Sie hören ihre Sätze als Computerstimme. Sprechen
          Sie ganz normal, Ihre Antwort wird als Text angezeigt.
        </p>

        {notice ? (
          <p key={notice} role="status" className="animate-rise text-sm text-danger">
            {notice}
          </p>
        ) : null}
      </main>

      <footer className="flex w-full items-center justify-center gap-4">
        {live ? (
          <>
            <button
              type="button"
              onClick={toggleMute}
              aria-pressed={muted}
              className={`flex h-16 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-line text-base font-medium shadow-card transition duration-200 ease-out-soft active:scale-[0.97] ${
                muted ? "bg-ink text-paper" : "bg-surface text-ink"
              }`}
            >
              {muted ? <MicOffIcon /> : <MicIcon />}
              {muted ? "Stumm" : "Mikrofon an"}
            </button>
            <button
              type="button"
              onClick={() => leave()}
              className="flex h-16 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-danger text-base font-medium text-white shadow-float transition duration-200 ease-out-soft active:scale-[0.97]"
            >
              <HangUpIcon />
              Auflegen
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={join}
            className="flex h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-call text-lg font-medium text-white shadow-float transition duration-200 ease-out-soft hover:brightness-105 active:scale-[0.97]"
          >
            <PhoneIcon />
            Beitreten
          </button>
        )}
      </footer>
    </div>
  );
}
