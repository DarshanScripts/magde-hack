"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Captions from "@/components/Captions";
import DialBar, { type CallPhase } from "@/components/DialBar";
import LangToggle from "@/components/LangToggle";
import LevelBars from "@/components/LevelBars";
import { HandIcon, SendIcon } from "@/components/icons";
import { createVoice, joinCall, describeCallError, soundOutputWorks } from "@/lib/call";
import { useI18n } from "@/lib/i18n";
import { startCaptions, type CaptionState } from "@/lib/stt";
import { setProfileName, useMockMode, useProfileName } from "@/lib/profile";
import labels from "@/lib/labels.json";
import { IDENTITY, MOCK_CONTACTS, TTS_TRACK_NAME, type Caption, type Token, type Turn } from "@/lib/contract";

const UNCERTAIN = "?";
const SENTENCE_DELAY_MS = 1500;
const HISTORY_TURNS = 6;
const PILL =
  "h-8 shrink-0 cursor-pointer rounded-full px-4 text-sm font-medium transition duration-200 ease-out-soft active:scale-[0.97]";
const MOCK_LABELS = [...labels.p0, ...labels.p1, UNCERTAIN];
const MOCK_FLAGS: { key: "flagYesNo" | "flagWh" | "flagNegation"; question?: Token["question"] }[] = [
  { key: "flagYesNo", question: "yn" },
  { key: "flagWh", question: "wh" },
  { key: "flagNegation" },
];

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
  const [captionState, setCaptionState] = useState<CaptionState | null>(null);
  const [theirTrack, setTheirTrack] = useState<MediaStreamTrack | null>(null);
  const [myTrack, setMyTrack] = useState<MediaStreamTrack | null>(null);
  const [chips, setChips] = useState<Token[]>([]);
  const [mockFlags, setMockFlags] = useState<Pick<Token, "question" | "negation">>({});
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null);
  const session = useRef<Session | null>(null);
  const nextId = useRef(0);
  const pending = useRef<{ chips: Token[]; timer?: ReturnType<typeof setTimeout> }>({ chips: [] });
  const history = useRef<Turn[]>([]);
  const confirmRef = useRef(false);
  const previewRef = useRef<{ id: string; text: string } | null>(null);
  const { t } = useI18n();
  const profileName = useProfileName();
  const mock = useMockMode();

  useEffect(() => {
    history.current = captions.filter((c) => c.final || c.who === "them").slice(-HISTORY_TURNS).map(({ who, text }) => ({ who, text }));
  }, [captions]);

  function updateChips(next: Token[]) {
    clearTimeout(pending.current.timer);
    pending.current = { chips: next, timer: next.length ? setTimeout(sendChips, SENTENCE_DELAY_MS) : undefined };
    setChips(next);
  }

  // The single entry point for recognized signs: the camera and the mock buttons both call it.
  function addToken(token: Token) {
    if (session.current?.voice) updateChips([...pending.current.chips, token]);
  }

  async function speakCaption(id: string, text: string) {
    try {
      await session.current?.voice?.speak(text);
      setCaptions((list) => list.map((c) => (c.id === id ? { ...c, final: true } : c)));
    } catch (err) {
      console.error(err);
      setCaptions((list) => list.filter((c) => c.id !== id));
      setNotice(t("ttsFailed"));
    }
  }

  // Recognized signs -> one German sentence -> spoken into the call.
  async function sendChips() {
    const real = pending.current.chips.filter((c) => c.label !== UNCERTAIN);
    const gloss = real.map((c) => c.label);
    const question = real.findLast((c) => c.question)?.question ?? null;
    const negation = real.some((c) => c.negation);
    updateChips([]);
    setMockFlags({});
    discardPreview();
    if (!gloss.length || !session.current?.voice) return;
    const id = `me-${nextId.current++}`;
    setCaptions((list) => [...list, { id, who: "me", text: "…", final: false, gloss }]);
    try {
      const res = await fetch("/api/sentence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: gloss, history: history.current, profile: { name: profileName }, question, negation }),
      });
      if (!res.ok) throw new Error("sentence request failed");
      const { text } = (await res.json()) as { text: string };
      setCaptions((list) => list.map((c) => (c.id === id ? { ...c, text } : c)));
      if (confirmRef.current) showPreview({ id, text });
      else await speakCaption(id, text);
    } catch (err) {
      console.error(err);
      setCaptions((list) => list.filter((c) => c.id !== id));
      setNotice(t("sentenceFailed"));
    }
  }

  // Confirm mode: the sentence waits as a preview until it is confirmed or discarded.
  function showPreview(next: { id: string; text: string } | null) {
    previewRef.current = next;
    setPreview(next);
  }

  function discardPreview() {
    const id = previewRef.current?.id;
    if (!id) return;
    showPreview(null);
    setCaptions((list) => list.filter((c) => c.id !== id));
  }

  function speakPreview() {
    const current = previewRef.current;
    if (!current) return;
    showPreview(null);
    void speakCaption(current.id, current.text);
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (!pending.current.chips.length) {
      if (!preview) return;
      if (e.key === "Enter") speakPreview();
      else if (e.key === "Escape") discardPreview();
      else return;
    } else if (e.key === "Enter") void sendChips();
    else if (e.key === "Backspace") updateChips(pending.current.chips.slice(0, -1));
    else if (e.key === "Escape") updateChips([]);
    else return;
    e.preventDefault();
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  function reset(message: string | null) {
    session.current = null;
    clearTimeout(pending.current.timer);
    pending.current = { chips: [] };
    setChips([]);
    discardPreview();
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
          else hangUp(t("practiceHungUp"));
        },
        onEnd: (reason) => {
          if (session.current) reset(t(reason === "duplicate" ? "duplicateSigner" : "connectionLost"));
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
      if (!(await soundOutputWorks()) && session.current) setNotice(t("noSoundOutput"));
    } catch (err) {
      console.error(err);
      hangUp(describeCallError(err, t));
    }
  }

  async function say(text: string) {
    if (!session.current?.voice || !text) return;
    const id = `me-${nextId.current++}`;
    setDraft("");
    setCaptions((list) => [...list, { id, who: "me", text, final: false }]);
    await speakCaption(id, text);
  }

  // The practice's speech becomes "them" captions: one bubble grows with the partials, then turns final.
  useEffect(() => {
    if (!theirTrack) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    let count = 0;
    let openId: string | null = null;
    const show = (text: string, final: boolean) => {
      const id = (openId ??= `them-${theirTrack.id}-${count++}`);
      if (final) openId = null;
      setCaptions((list) =>
        list.some((c) => c.id === id)
          ? list.map((c) => (c.id === id ? { ...c, text, final } : c))
          : [...list, { id, who: "them", text, final }],
      );
    };
    startCaptions(theirTrack, {
      onPartial: (text) => show(text, false),
      onFinal: (text) => show(text, true),
      onState: (state) => !cancelled && setCaptionState(state),
    })
      .then((s) => (cancelled ? s() : (stop = s)))
      .catch((err) => {
        console.error("captions:", err);
        if (!cancelled) setCaptionState("failed");
      });
    return () => {
      cancelled = true;
      stop?.();
      setCaptionState(null);
      setCaptions((list) => list.map((c) => (c.who === "them" && !c.final ? { ...c, final: true } : c)));
    };
  }, [theirTrack]);

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
        <p className="hidden text-sm text-muted lg:block">{t("tagline")}</p>
        <div className="flex items-center gap-3">
          <a
            href="/callee"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted underline decoration-line underline-offset-4 transition-colors duration-200 hover:text-ink"
          >
            {t("practicePage")}
          </a>
          <input
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            maxLength={60}
            placeholder={t("yourName")}
            aria-label={t("yourName")}
            className="h-9 w-36 rounded-full border border-line bg-surface px-4 text-sm outline-none transition-shadow duration-200 placeholder:text-faint focus:ring-2 focus:ring-accent/40"
          />
          <LangToggle />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[55fr_45fr]">
        <section className="flex min-h-0 flex-col rounded-[28px] border border-line bg-surface p-3 shadow-card">
          <div className="dot-grid relative flex min-h-48 flex-1 flex-col items-center justify-center gap-3 rounded-[20px] bg-sunken/60 text-center">
            <span className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm text-muted shadow-card">
              <span className="size-2 rounded-full bg-faint" />
              <span>{t("cameraOff")}</span>
            </span>
            <span className="flex size-16 items-center justify-center rounded-full bg-surface text-muted shadow-card">
              <HandIcon width={28} height={28} />
            </span>
            <p className="text-lg font-medium">{t("signCamera")}</p>
            <p className="max-w-xs text-sm text-muted">{t(mock ? "mockHint" : "cameraHint")}</p>
            {mock ? (
              <div className="flex max-w-xl flex-wrap justify-center gap-1.5 px-4 pt-2">
                {MOCK_LABELS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    disabled={!connected}
                    onClick={() => addToken({ label, conf: 1, t: Date.now(), ...mockFlags })}
                    className="h-9 cursor-pointer rounded-full border border-line bg-surface px-3 font-mono text-xs tracking-wide shadow-card transition duration-200 ease-out-soft hover:border-accent hover:text-accent active:scale-[0.96] disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-line"
                  >
                    {label}
                  </button>
                ))}
                <span className="basis-full" />
                {MOCK_FLAGS.map((flag) => {
                  const on = flag.question ? mockFlags.question === flag.question : !!mockFlags.negation;
                  return (
                    <button
                      key={flag.key}
                      type="button"
                      disabled={!connected}
                      aria-pressed={on}
                      onClick={() =>
                        setMockFlags((f) =>
                          flag.question ? { ...f, question: on ? undefined : flag.question } : { ...f, negation: on ? undefined : true },
                        )
                      }
                      className={`h-9 cursor-pointer rounded-full border px-3 text-xs shadow-card transition duration-200 ease-out-soft active:scale-[0.96] disabled:cursor-not-allowed disabled:text-faint ${
                        on ? "border-accent bg-accent text-white" : "border-line bg-surface text-muted hover:border-accent hover:text-accent"
                      }`}
                    >
                      <span>{t(flag.key)}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="flex min-h-16 items-center gap-3 px-3 pt-3 pb-1">
            <span className="shrink-0 text-sm text-muted">{t("recognizedSigns")}</span>
            {chips.length ? (
              <>
                <span data-chips className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {chips.map((chip, i) => (
                    <span
                      key={i}
                      className={`animate-rise flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs tracking-wide ${
                        chip.label === UNCERTAIN ? "bg-sunken text-faint" : "bg-accent/10 text-accent"
                      }`}
                    >
                      <span>{chip.label}</span>
                      {chip.question ? (
                        <span title={t(chip.question === "yn" ? "flagYesNo" : "flagWh")} className="rounded-full bg-accent px-1.5 text-[10px] text-white">
                          {chip.question === "yn" ? "?" : "W?"}
                        </span>
                      ) : null}
                      {chip.negation ? (
                        <span title={t("flagNegation")} className="rounded-full bg-danger px-1.5 text-[10px] text-white">
                          ¬
                        </span>
                      ) : null}
                    </span>
                  ))}
                </span>
                <span className="hidden shrink-0 text-xs text-faint xl:block">{t("chipKeys")}</span>
              </>
            ) : preview ? (
              <>
                <span className="h-px flex-1 bg-line" />
                <span className="hidden text-xs text-faint xl:block">{t("confirmKeys")}</span>
                <button type="button" onClick={discardPreview} className={`${PILL} border border-line text-muted hover:text-ink`}>
                  <span>{t("discard")}</span>
                </button>
                <button type="button" onClick={speakPreview} className={`${PILL} bg-accent text-white hover:brightness-110`}>
                  <span>{t("say")}</span>
                </button>
              </>
            ) : (
              <>
                <span className="h-px flex-1 bg-line" />
                <span className="font-mono text-xs text-faint">{t("noneYet")}</span>
              </>
            )}
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => {
                  confirmRef.current = e.target.checked;
                  setConfirm(e.target.checked);
                  if (!e.target.checked) discardPreview();
                }}
                className="size-4 accent-accent"
              />
              <span>{t("confirmMode")}</span>
            </label>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-line bg-surface shadow-card">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-6">
            <h2 className="text-lg font-medium">{t("conversation")}</h2>
            {connected ? (
              <span className="flex items-center gap-4 text-sm text-muted">
                {captionState ? (
                  <span data-captions={captionState} className={captionState === "failed" ? "text-danger" : undefined}>
                    {t(captionState === "live" ? "captionsLive" : captionState === "failed" ? "captionsFailed" : "captionsConnecting")}
                  </span>
                ) : null}
                <span className="flex items-center gap-2">
                  <span>{t("practice")}</span> <LevelBars track={theirTrack} className="text-call" />
                </span>
                <span className="flex items-center gap-2">
                  <span>{t("yourVoice")}</span> <LevelBars track={myTrack} className="text-accent" />
                </span>
              </span>
            ) : null}
          </div>

          <Captions
            captions={captions}
            awaitingId={preview?.id}
            empty={
              <p className="max-w-xs text-base text-muted">
                {connected
                  ? t("emptyConnected")
                  : phase === "idle"
                    ? t("emptyIdle")
                    : t("emptyCalling", { name: practice })}
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
              placeholder={t(connected ? "inputConnected" : "inputIdle")}
              aria-label={t("inputLabel")}
              className="h-12 min-w-0 flex-1 rounded-full bg-sunken/70 px-5 text-base outline-none transition-shadow duration-200 placeholder:text-faint focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!connected || !draft.trim()}
              className="flex h-12 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-accent pr-5 pl-4 text-base font-medium text-white transition duration-200 ease-out-soft hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-sunken disabled:text-faint"
            >
              <SendIcon width={18} height={18} />
              <span>{t("say")}</span>
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
