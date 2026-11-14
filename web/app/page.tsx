"use client";

import { useEffect, useRef, useState } from "react";
import Captions from "@/components/Captions";
import DialBar, { type CallPhase } from "@/components/DialBar";
import LevelBars from "@/components/LevelBars";
import { HandIcon, SendIcon } from "@/components/icons";
import { createVoice, joinCall, describeCallError } from "@/lib/call";
import { IDENTITY, MOCK_CONTACTS, TTS_TRACK_NAME, type Caption } from "@/lib/contract";

type Session = {
  leave(): Promise<void>;
  voice?: Awaited<ReturnType<typeof createVoice>>;
};

export default function SignerPage() {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [contact, setContact] = useState(0);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [theirTrack, setTheirTrack] = useState<MediaStreamTrack | null>(null);
  const [myTrack, setMyTrack] = useState<MediaStreamTrack | null>(null);
  const session = useRef<Session | null>(null);
  const nextId = useRef(0);

  function reset(message: string | null) {
    session.current = null;
    setPhase("idle");
    setTheirTrack(null);
    setMyTrack(null);
    setNotice(message);
  }

  function hangUp(message: string | null = null) {
    const current = session.current;
    reset(message);
    current?.voice?.stop();
    void current?.leave();
  }

  async function dial() {
    setNotice(null);
    setCaptions([]);
    setPhase("connecting");
    try {
      const call = await joinCall(IDENTITY.signer, {
        onRemoteAudio: setTheirTrack,
        onPeer: (state) => {
          if (state === "joined") setPhase("connected");
          else hangUp("Die Praxis hat aufgelegt.");
        },
        onEnd: () => {
          if (session.current) reset("Die Verbindung wurde getrennt.");
        },
      });
      session.current = { leave: call.leave };
      const voice = await createVoice(call.room);
      if (!session.current) return;
      session.current.voice = voice;
      setMyTrack(
        call.room.localParticipant.getTrackPublicationByName(TTS_TRACK_NAME)?.track?.mediaStreamTrack ?? null,
      );
      setPhase((p) => (p === "connecting" ? "ringing" : p));
    } catch (err) {
      console.error(err);
      hangUp(describeCallError(err));
    }
  }

  async function say(text: string) {
    const voice = session.current?.voice;
    if (!voice || !text) return;
    const id = `me-${nextId.current++}`;
    setDraft("");
    setCaptions((list) => [...list, { id, who: "me", text, final: false }]);
    try {
      await voice.speak(text);
      setCaptions((list) => list.map((c) => (c.id === id ? { ...c, final: true } : c)));
    } catch (err) {
      console.error(err);
      setCaptions((list) => list.filter((c) => c.id !== id));
      setNotice("Die Sprachausgabe ist fehlgeschlagen.");
    }
  }

  useEffect(
    () => () => {
      session.current?.voice?.stop();
      void session.current?.leave();
    },
    [],
  );

  const connected = phase === "connected";
  const practice = MOCK_CONTACTS[contact].name;

  return (
    <div className="flex h-dvh min-h-[640px] flex-col gap-4 p-4 sm:p-5">
      <header className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-ink text-paper">
            <HandIcon width={18} height={18} />
          </span>
          <span className="text-lg font-semibold tracking-tight">DGS Call</span>
        </div>
        <p className="hidden text-sm text-muted sm:block">Gebärden werden zur Stimme. Sprache wird zu Text.</p>
      </header>

      <main className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[55fr_45fr]">
        <section className="flex min-h-0 flex-col rounded-[28px] border border-line bg-surface p-3 shadow-card">
          <div className="dot-grid relative flex min-h-48 flex-1 flex-col items-center justify-center gap-3 rounded-[20px] bg-sunken/60 text-center">
            <span className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm text-muted shadow-card">
              <span className="size-2 rounded-full bg-faint" />
              Kamera aus
            </span>
            <span className="flex size-16 items-center justify-center rounded-full bg-surface text-muted shadow-card">
              <HandIcon width={28} height={28} />
            </span>
            <p className="text-lg font-medium">Gebärdenkamera</p>
            <p className="max-w-xs text-sm text-muted">
              Hier erscheint Ihr Kamerabild, sobald die Gebärdenerkennung angeschlossen ist.
            </p>
          </div>
          <div className="flex min-h-16 items-center gap-3 px-3 pt-3 pb-1">
            <span className="shrink-0 text-sm text-muted">Erkannte Gebärden</span>
            <span className="h-px flex-1 bg-line" />
            <span className="font-mono text-xs text-faint">noch keine</span>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-line bg-surface shadow-card">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-6">
            <h2 className="text-lg font-medium">Gespräch</h2>
            {connected ? (
              <span className="flex items-center gap-4 text-sm text-muted">
                <span className="flex items-center gap-2">
                  Praxis <LevelBars track={theirTrack} className="text-call" />
                </span>
                <span className="flex items-center gap-2">
                  Ihre Stimme <LevelBars track={myTrack} className="text-accent" />
                </span>
              </span>
            ) : null}
          </div>

          <Captions
            captions={captions}
            empty={
              <p className="max-w-xs text-base text-muted">
                {connected
                  ? "Verbunden. Schreiben Sie unten einen Satz, er wird der Praxis vorgelesen."
                  : phase === "idle"
                    ? "Wählen Sie unten eine Praxis und starten Sie den Anruf."
                    : `${practice} wird angerufen …`}
              </p>
            }
          />

          <form
            className="flex shrink-0 items-center gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void say(draft.trim());
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!connected}
              maxLength={500}
              placeholder={connected ? "Satz eingeben, der vorgelesen wird" : "Erst im Anruf verfügbar"}
              aria-label="Satz, der vorgelesen wird"
              className="h-12 min-w-0 flex-1 rounded-full bg-sunken/70 px-5 text-base outline-none transition-shadow duration-200 placeholder:text-faint focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!connected || !draft.trim()}
              className="flex h-12 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-accent pr-5 pl-4 text-base font-medium text-white transition duration-200 ease-out-soft hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-sunken disabled:text-faint"
            >
              <SendIcon width={18} height={18} />
              Sagen
            </button>
          </form>
        </section>
      </main>

      <footer className="flex flex-col items-center gap-2">
        {notice ? (
          <p key={notice} role="status" className="animate-rise text-sm text-muted">
            {notice}
          </p>
        ) : null}
        <DialBar phase={phase} contact={contact} onContact={setContact} onDial={dial} onHangUp={() => hangUp()} />
      </footer>
    </div>
  );
}
