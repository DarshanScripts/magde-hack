"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import labels from "@/lib/labels.json";
import refs from "@/lib/signRefs.json";
import { SIGN_WS_URL, type SignStatus, type Token } from "@/lib/contract";

const SignCamera = dynamic(() => import("@/components/SignCamera"), { ssr: false });
const SERVICE_URL = SIGN_WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const EXTRA = ["KOPF", "BAUCH", "FIEBER", "VORMITTAG", "ABEND", "OKAY", "NICHT", "MOECHTEN",
  "EINS", "ZWEI", "DREI", "VIER", "FUENF", "SECHS", "SIEBEN", "ACHT", "NEUN", "ZEHN"];
const RECORD_ORDER = [...labels.p0, ...EXTRA, labels.none];
// median length of the first (normal-speed) session per sign, seconds
const BASE_S: Record<string, number> = {
  HALLO: 1.7, DANKE: 0.9, TSCHUESS: 1.0, JA: 0.8, NEIN: 0.9, WIEDERHOLEN: 1.2, NAME: 0.7, TERMIN: 1.6,
  WOLLEN: 0.8, HEUTE: 1.05, MORGEN: 1.2, NACHMITTAG: 1.35, UHR: 1.2, UNTERSUCHUNG: 1.4, SCHMERZ: 2.4,
};
const HINTS: Record<string, string> = {
  EINS: "Thumb up (fist, thumb out), palm towards you. Not a thumbs-up gesture: hold at chest, short downward tap.",
  ZWEI: "Thumb + index finger out, palm towards you.",
  DREI: "Thumb + index + middle finger out.",
  VIER: "Four fingers out, thumb folded in.",
  FUENF: "Open hand, all five fingers spread.",
  SECHS: "Open dominant hand (5) + thumb of the other hand.",
  SIEBEN: "Open dominant hand (5) + thumb and index of the other hand.",
  ACHT: "Open dominant hand (5) + thumb, index and middle of the other hand.",
  NEUN: "Open dominant hand (5) + four fingers (no thumb) of the other hand.",
  ZEHN: "Both hands open (5 + 5).",
};
const PAUSE_MS = 2500;
const SENTENCE_GAP_MS = 4000;

function flags(tokens: Token[]) {
  const question = [...tokens].reverse().find((t) => t.question)?.question ?? null;
  return { question, negation: tokens.some((t) => t.negation) };
}
// Recording phases per label, in order: [takes, continuous (hands stay up), fast]
type Phase = [number, boolean, boolean];
const PHASES = (l: string): Phase[] =>
  l === labels.none
    ? [[34, false, false]] // already recorded
    : labels.p0.includes(l)
      ? [[15, false, false]] // 15 max; core signs already have them
      : [[8, false, false], [7, true, false]]; // 15 max: 8 hands down (done), rest continuous
const targetOf = (l: string) => PHASES(l).reduce((n, [k]) => n + k, 0);
// phase for the next take; `start` = count at which it begins
function say(text: string) {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 1.1;
  speechSynthesis.speak(u);
}
const phaseName = (p: { chain: boolean; fast: boolean }) => `${p.fast ? "fast, " : ""}${p.chain ? "continuous" : "hands down"}`;
function phaseLeft(l: string, count: number) {
  const p = phaseAt(l, count);
  const k = PHASES(l).find((_, i, all) => all.slice(0, i).reduce((n, [x]) => n + x, 0) === p.start)?.[0] ?? 0;
  return p.start + k - count;
}
type Style = { chain: boolean; fast: boolean };
const BLOCK = 1000; // stay in one style until no label needs it (few switches)
const same = (a: Style, b: Style) => a.chain === b.chain && a.fast === b.fast;
// first style (in a fixed order) that some label still needs
function pickStyle(counts: Record<string, number>): Style | null {
  const left = new Map<string, number>();
  for (const l of RECORD_ORDER) {
    const n = counts[l] ?? 0;
    if (n >= targetOf(l)) continue;
    const p = phaseAt(l, n), key = `${p.chain}|${p.fast}`;
    left.set(key, (left.get(key) ?? 0) + phaseLeft(l, n));
  }
  // order: hands down → continuous → fast (so every word gets basic data first if time runs out)
  const best = ["false|false", "true|false", "false|true", "true|true"].filter((k) => left.has(k)).map((k) => [k])[0];
  return best ? { chain: best[0].startsWith("true"), fast: best[0].endsWith("true") } : null;
}
// random label whose current phase has this style, weighted by takes left, never the same twice in a row
function pickLabel(counts: Record<string, number>, style: Style, not: string[]): string | null {
  const c = RECORD_ORDER.filter((l) => (counts[l] ?? 0) < targetOf(l) && same(phaseAt(l, counts[l] ?? 0), style));
  const pool = c.filter((l) => !not.includes(l)).length ? c.filter((l) => !not.includes(l)) : c;
  const w = pool.map((l) => phaseLeft(l, counts[l] ?? 0));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((r -= w[i]) < 0) return pool[i];
  return pool[0] ?? null;
}

function phaseAt(l: string, count: number) {
  let start = 0;
  for (const [k, chain, fast] of PHASES(l)) {
    if (count < start + k) return { start, chain, fast };
    start += k;
  }
  return { start, chain: false, fast: false };
}
const REFS: Record<string, { video: string; word: string; credit: string; license: string }> = refs;

function beep(times = 1, freq = 880) {
  const ctx = new AudioContext();
  for (let i = 0; i < times; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.1;
    osc.connect(gain).connect(ctx.destination);
    if (i === times - 1) osc.onended = () => ctx.close();
    osc.start(ctx.currentTime + i * 0.2);
    osc.stop(ctx.currentTime + i * 0.2 + 0.12);
  }
}

export default function RecordPage() {
  const [mode, setMode] = useState<"record" | "infer">("infer");
  const [signer, setSigner] = useState("adi");
  const [label, setLabel] = useState(labels.p0[0]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hasModel, setHasModel] = useState(false);
  const [history, setHistory] = useState<Token[]>([]);
  const [status, setStatus] = useState<SignStatus>({ state: "rest", fps: 0, online: false });
  const [takeMs, setTakeMs] = useState(0);
  const [random, setRandom] = useState(true);
  const randomRef = useRef(true);
  const [upNext, setUpNext] = useState<string | null>(null);
  const [blockStyle, setBlockStyle] = useState<Style | null>(null);
  const prompt = useRef<{ style: Style | null; left: number; next: string | null }>({ style: null, left: 0, next: null });
  const [chainOverride, setChainOverride] = useState<{ label: string; on: boolean } | null>(null);
  const signStart = useRef(0);
  const onStatus = useCallback((s: SignStatus) => {
    if (s.state === "signing" && !signStart.current) signStart.current = Date.now();
    if (s.state === "rest") setTimeout(() => (signStart.current = 0), 300);
    setStatus(s);
  }, []);
  const [token, setToken] = useState<Token | null>(null);
  const [flash, setFlash] = useState(false);
  const [paused, setPaused] = useState(false);
  const [buffer, setBuffer] = useState<Token[]>([]);
  const [sentences, setSentences] = useState<Token[][]>([]);
  const bufferRef = useRef<Token[]>([]);
  const sentenceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const labelRef = useRef(label);
  const countsRef = useRef(counts);
  useEffect(() => {
    labelRef.current = label;
    countsRef.current = counts;
  });

  const refreshCounts = useCallback(async () => {
    try {
      const res = await fetch(`${SERVICE_URL}/health`);
      const h = await res.json();
      setCounts(h.counts);
      setHasModel(h.model);
    } catch {}
  }, []);

  useEffect(() => {
    const first = setTimeout(refreshCounts, 0);
    const id = setInterval(refreshCounts, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refreshCounts]);

  const startBlock = useCallback((counts: Record<string, number>, after: string[]) => {
    const style = pickStyle(counts);
    if (!style) {
      say("All recordings done. Tell the agent.");
      return null;
    }
    const first = pickLabel(counts, style, after);
    const prev = prompt.current.style;
    prompt.current = { style, left: BLOCK, next: first && pickLabel(counts, style, [first]) };
    setUpNext(prompt.current.next);
    setBlockStyle(style);
    if (!prev || !same(prev, style)) say(`Random signs, ${phaseName(style)}`);
    return first;
  }, []);

  useEffect(() => {
    if (mode !== "record") return;
    if (randomRef.current) {
      if (!prompt.current.style) {
        const first = startBlock(countsRef.current, []);
        if (first) setTimeout(() => setLabel(first), 0);
      }
      return;
    }
    const n = countsRef.current[label] ?? 0;
    if (n < targetOf(label)) say(`${label}. ${phaseName(phaseAt(label, n))}, ${phaseLeft(label, n)} times`);
  }, [mode, label, startBlock]);

  const onRecorded = useCallback((lab: string, count: number) => {
    if (signStart.current) setTakeMs(Date.now() - signStart.current - 150);
    const next = { ...countsRef.current, [lab]: count };
    setCounts(next);
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
    const todo = RECORD_ORDER.find((l) => (next[l] ?? 0) < targetOf(l));
    const base = BASE_S[lab] * (phaseAt(lab, count - 1).fast ? 0.65 : 1);
    const ms = signStart.current ? Date.now() - signStart.current - 150 : 0;
    if (base && ms && (ms > base * 1900 || ms < base * 450)) say(ms > base * 1900 ? "too long, two signs? undo" : "too short, undo?");
    if (randomRef.current) {
      const pr = prompt.current;
      pr.left -= 1;
      const ok = (l: string | null) => l && pr.style && (next[l] ?? 0) < targetOf(l) && same(phaseAt(l, next[l] ?? 0), pr.style);
      let cur = ok(pr.next) && pr.left > 0 ? pr.next : null;
      if (!cur && pr.left > 0 && pr.style) cur = pickLabel(next, pr.style, [lab]);
      if (!cur) {
        const prev = pr.style;
        cur = startBlock(next, [lab]);
        if (!cur) return beep(2, 1320);
        const now = prompt.current.style;
        if (prev && now && !same(prev, now)) {
          beep(3, 660);
          setPaused(true);
          setTimeout(() => setPaused(false), PAUSE_MS);
        } else beep();
      } else {
        pr.next = pickLabel(next, pr.style!, [cur]);
        setUpNext(pr.next);
        beep();
      }
      setLabel(cur);
      return;
    }
    if (lab === labelRef.current && count < targetOf(lab) && phaseAt(lab, count).start === count) {
      // new phase: short pause in saving so there is time to change the way of signing
      beep(3, 660);
      say(`Now ${phaseName(phaseAt(lab, count))}, ${phaseLeft(lab, count)} times`);
      setPaused(true);
      setTimeout(() => setPaused(false), PAUSE_MS);
      return;
    }
    if (!todo && count >= targetOf(lab)) say("All recordings done. Tell the agent.");
    if (lab !== labelRef.current || count < targetOf(lab) || !todo) return beep();
    // target reached: pause saving, switch to the next unfinished label, then resume
    beep(2, 1320);
    setPaused(true);
    setLabel(todo);
    setTimeout(() => setPaused(false), PAUSE_MS);
  }, [startBlock]);

  const endSentence = useCallback(() => {
    clearTimeout(sentenceTimer.current);
    const b = bufferRef.current;
    if (!b.length) return;
    bufferRef.current = [];
    setBuffer([]);
    setSentences((s) => [...s.slice(-19), b]);
  }, []);

  const onToken = useCallback(
    (t: Token) => {
      setToken(t);
      setHistory((h) => [...h.slice(-11), t]);
      if (t.label === "?") return;
      bufferRef.current = [...bufferRef.current, t];
      setBuffer(bufferRef.current);
      clearTimeout(sentenceTimer.current);
      sentenceTimer.current = setTimeout(endSentence, SENTENCE_GAP_MS);
    },
    [endSentence],
  );

  useEffect(() => {
    if (mode !== "infer") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Enter") endSentence();
      if (e.key === "Backspace") {
        bufferRef.current = bufferRef.current.slice(0, -1);
        setBuffer(bufferRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, endSentence]);

  const resetLabel = async () => {
    if (!confirm(`Delete all ${counts[label] ?? 0} ${label} samples of "${signer}"?`)) return;
    const res = await fetch(`${SERVICE_URL}/reset/${label}?signer=${encodeURIComponent(signer)}`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const { count } = await res.json();
      setCounts((c) => ({ ...c, [label]: count }));
    }
  };

  const undo = useCallback(async () => {
    const res = await fetch(`${SERVICE_URL}/undo`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const { label: lab, count } = await res.json();
      setCounts((c) => ({ ...c, [lab]: count }));
      if (lab !== labelRef.current) setLabel(lab); // undo right after an auto-advance goes back to that label
      beep(1, 330);
    } else say("nothing to undo");
  }, []);

  useEffect(() => {
    if (mode !== "record") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Backspace" || e.key === "u") {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, undo]);

  const nextLabel = () => setLabel(RECORD_ORDER[(RECORD_ORDER.indexOf(label) + 1) % RECORD_ORDER.length]);
  const current = counts[label] ?? 0;
  const phase = phaseAt(label, current);
  const style = random && blockStyle ? blockStyle : phase;
  const chain = chainOverride?.label === label ? chainOverride.on : style.chain;
  const btn = "rounded-lg px-3 py-2 font-medium";

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-7xl gap-6 bg-white p-6 text-zinc-900 lg:grid-cols-2">
      <SignCamera
        mode={paused ? "infer" : mode}
        recordLabel={label}
        signer={signer}
        chain={chain}
        onToken={onToken}
        onStatus={onStatus}
        onRecorded={onRecorded}
      />

      <aside className="flex flex-col gap-4">
        <div className="flex gap-2">
          {(["record", "infer"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`${btn} flex-1 ${mode === m ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-800"}`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "record" && (
          <button onClick={undo} className={`${btn} bg-amber-400 py-4 text-2xl font-bold text-zinc-900 hover:bg-amber-300`}>
            ↶ UNDO LAST TAKE <span className="text-base font-medium">(Backspace or U)</span>
          </button>
        )}

        <p className="text-sm text-zinc-600">
          service: {status.online ? `online · ${status.fps} fps · ${status.state}` : "offline"} · model:{" "}
          {hasModel ? "loaded" : "not trained yet"}
        </p>

        {mode === "record" ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              signer
              <input value={signer} onChange={(e) => setSigner(e.target.value)} className="rounded border bg-white px-2 py-1 text-zinc-900" />
            </label>
            <label className="flex items-center gap-2 rounded bg-sky-100 p-2 text-sm font-semibold text-zinc-900">
              <input
                type="checkbox"
                checked={random}
                onChange={(e) => {
                  randomRef.current = e.target.checked;
                  setRandom(e.target.checked);
                  prompt.current.style = null;
                  if (e.target.checked) {
                    const first = startBlock(countsRef.current, []);
                    if (first) setLabel(first);
                  }
                }}
              />
              random signs (the page picks the next sign after every take)
            </label>
            <label className={`flex items-center gap-2 rounded p-2 text-sm text-zinc-900 ${chain ? "bg-violet-300 font-semibold" : "bg-zinc-200 font-semibold"}`}>
              <input type="checkbox" checked={chain} onChange={(e) => setChainOverride({ label, on: e.target.checked })} />
              {style.fast && <b className="text-red-700">FAST · </b>}
              {chain
                ? "CONTINUOUS: hands stay up, ½ s stop in the air = one sample (stop before lowering)"
                : "LOWERED: hands down between takes"}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              label
              <select value={label} onChange={(e) => setLabel(e.target.value)} className="rounded border bg-white px-2 py-1 text-lg text-zinc-900">
                {Object.entries({ p0: labels.p0, extra: EXTRA, none: [labels.none] }).map(([group, list]) => (
                  <optgroup key={group} label={group}>
                    {list.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div
              className={`rounded-xl p-4 text-center transition-colors ${paused ? "bg-sky-200" : flash ? "bg-green-300" : current >= targetOf(label) ? "bg-green-100" : "bg-zinc-100"}`}
            >
              {paused && <div className="text-sm font-semibold text-sky-800">get ready…</div>}
              {current < targetOf(label) ? (
                <div className={`rounded-lg px-2 py-1 text-xl font-bold text-white ${style.fast ? "bg-red-600" : chain ? "bg-violet-600" : "bg-zinc-700"}`}>
                  {phaseName(style).toUpperCase()}{random ? "" : ` · ${phaseLeft(label, current)} left`}
                </div>
              ) : (
                <div className="rounded-lg bg-green-600 px-2 py-1 text-xl font-bold text-white">DONE</div>
              )}
              <div className={random ? "text-6xl font-black tracking-wide" : "text-2xl font-semibold"}>{label}</div>
              {random && upNext && <div className="text-lg text-zinc-600">next: <b>{upNext}</b></div>}
              <div className="text-7xl font-bold tabular-nums">{current}</div>
              <div className="text-sm text-zinc-600">target {targetOf(label)}</div>
              {takeMs > 0 && (
                <div className="text-sm text-zinc-700">
                  last take {(takeMs / 1000).toFixed(2)} s{BASE_S[label] && ` · normal ≈ ${BASE_S[label]} s, fast ≈ ${(BASE_S[label] * 0.65).toFixed(1)} s`}
                </div>
              )}
            </div>
            {HINTS[label] && <p className="rounded-lg bg-amber-100 p-3 text-lg text-zinc-900">{HINTS[label]}</p>}
            {REFS[label] && (
              <figure className="flex flex-col gap-1">
                <video key={label} src={REFS[label].video} autoPlay loop muted playsInline className="w-full rounded-lg bg-black" />
                <figcaption className="text-xs text-zinc-500">
                  Reference: „{REFS[label].word}“ · {REFS[label].credit} via SignDict.org · {REFS[label].license}
                </figcaption>
              </figure>
            )}
            <div className="flex gap-2">
              <button onClick={undo} className={`${btn} flex-1 bg-amber-200`}>
                undo last
              </button>
              <button onClick={nextLabel} className={`${btn} flex-1 bg-zinc-200`}>
                next label
              </button>
            </div>
            <button onClick={resetLabel} disabled={!current} className={`${btn} bg-red-600 text-white disabled:opacity-40`}>
              reset {label} (delete all {current})
            </button>
          </>
        ) : (
          <div className="rounded-xl bg-zinc-900 p-4 text-white">
            <div className="text-sm text-zinc-400">last prediction</div>
            <div
              className={`flex flex-wrap items-center gap-2 py-2 text-6xl font-bold ${!token ? "text-zinc-500" : token.label === "?" ? "text-amber-400" : "text-green-400"}`}
            >
              {token?.label ?? "–"}
              {token && <span className="text-2xl font-medium text-zinc-300">{Math.round(token.conf * 100)}%</span>}
              {token?.question && <span className="rounded bg-fuchsia-600 px-2 text-xl text-white">{token.question === "yn" ? "? ja/nein" : "? W-Frage"}</span>}
              {token?.negation && <span className="rounded bg-red-600 px-2 text-xl text-white">¬ nicht</span>}
            </div>
            {token?.top?.map(([l, p]) => (
              <div key={l} className="flex justify-between font-mono text-base text-zinc-200">
                <span>{l}</span>
                <span>{p.toFixed(2)}</span>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-1">
              {history.map((t, i) => (
                <span key={i} className={`rounded px-2 py-0.5 text-base font-semibold ${t.label === "?" ? "bg-amber-400 text-zinc-900" : "bg-blue-500 text-white"}`}>
                  {t.label}
                  {t.question ? "?" : ""}
                  {t.negation ? "¬" : ""}
                </span>
              ))}
            </div>
          </div>
        )}

        {mode === "infer" && (
          <div className="rounded-xl border-2 border-blue-500 p-4">
            <div className="flex items-center justify-between text-sm text-zinc-600">
              <span>current sentence (ends after {SENTENCE_GAP_MS / 1000} s pause or Enter · Backspace removes last)</span>
            </div>
            <div className="min-h-12 py-2 text-3xl font-bold text-blue-700">
              {buffer.length ? <Gloss tokens={buffer} /> : <span className="text-zinc-400">sign…</span>}
            </div>
            <button onClick={endSentence} disabled={!buffer.length} className={`${btn} w-full bg-blue-600 text-white disabled:opacity-40`}>
              end sentence (Enter)
            </button>
            {sentences.length > 0 && (
              <div className="mt-3 flex flex-col gap-1 border-t pt-2">
                <div className="flex justify-between text-sm text-zinc-600">
                  <span>sentences</span>
                  <button onClick={() => setSentences([])} className="underline">
                    clear
                  </button>
                </div>
                {[...sentences].reverse().map((s, i) => (
                  <div key={sentences.length - i} className="text-xl font-semibold">
                    <Gloss tokens={s} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="max-h-80 overflow-auto rounded-xl border p-3 font-mono text-sm">
          {RECORD_ORDER.map((l) => (
            <div key={l} className={`flex justify-between ${l === label ? "font-bold" : ""}`}>
              <span>{l}</span>
              <span className={(counts[l] ?? 0) >= targetOf(l) ? "text-green-700" : ""}>{counts[l] ?? 0}</span>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}

function Gloss({ tokens }: { tokens: Token[] }) {
  const { question, negation } = flags(tokens);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {tokens.map((t) => t.label).join(" · ")}
      {question && <span className="rounded bg-fuchsia-600 px-2 text-base text-white">{question === "yn" ? "? ja/nein" : "? W-Frage"}</span>}
      {negation && <span className="rounded bg-red-600 px-2 text-base text-white">¬ nicht</span>}
    </span>
  );
}
