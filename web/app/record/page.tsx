"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import labels from "@/lib/labels.json";
import refs from "@/lib/signRefs.json";
import { SIGN_WS_URL, type SignStatus, type Token } from "@/lib/contract";

const SignCamera = dynamic(() => import("@/components/SignCamera"), { ssr: false });
const SERVICE_URL = SIGN_WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const TARGET = 15;
const NONE_TARGET = 30;
const RECORD_ORDER = [...labels.p0, labels.none]; // p1 (numbers, extras) not recorded for now
const PAUSE_MS = 2500;
const targetOf = (l: string) => (l === labels.none ? NONE_TARGET : TARGET);
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
  const [token, setToken] = useState<Token | null>(null);
  const [flash, setFlash] = useState(false);
  const [paused, setPaused] = useState(false);
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

  const onRecorded = useCallback((lab: string, count: number) => {
    const next = { ...countsRef.current, [lab]: count };
    setCounts(next);
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
    const todo = RECORD_ORDER.find((l) => (next[l] ?? 0) < targetOf(l));
    if (lab !== labelRef.current || count < targetOf(lab) || !todo) return beep();
    // target reached: pause saving, switch to the next unfinished label, then resume
    beep(2, 1320);
    setPaused(true);
    setLabel(todo);
    setTimeout(() => setPaused(false), PAUSE_MS);
  }, []);

  const resetLabel = async () => {
    if (!confirm(`Delete all ${counts[label] ?? 0} ${label} samples of "${signer}"?`)) return;
    const res = await fetch(`${SERVICE_URL}/reset/${label}?signer=${encodeURIComponent(signer)}`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const { count } = await res.json();
      setCounts((c) => ({ ...c, [label]: count }));
    }
  };

  const undo = async () => {
    const res = await fetch(`${SERVICE_URL}/undo`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const { label: lab, count } = await res.json();
      setCounts((c) => ({ ...c, [lab]: count }));
    }
  };

  const nextLabel = () => setLabel(RECORD_ORDER[(RECORD_ORDER.indexOf(label) + 1) % RECORD_ORDER.length]);
  const current = counts[label] ?? 0;
  const btn = "rounded-lg px-3 py-2 font-medium";

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_380px]">
      <SignCamera
        mode={paused ? "infer" : mode}
        recordLabel={label}
        signer={signer}
        onToken={(t) => {
          setToken(t);
          setHistory((h) => [...h.slice(-11), t]);
        }}
        onStatus={setStatus}
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

        <p className="text-sm text-zinc-600">
          service: {status.online ? `online · ${status.fps} fps · ${status.state}` : "offline"} · model:{" "}
          {hasModel ? "loaded" : "not trained yet"}
        </p>

        {mode === "record" ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              signer
              <input value={signer} onChange={(e) => setSigner(e.target.value)} className="rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              label
              <select value={label} onChange={(e) => setLabel(e.target.value)} className="rounded border px-2 py-1 text-lg">
                {Object.entries({ p0: labels.p0, none: [labels.none] }).map(([group, list]) => (
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
              {paused && <div className="text-sm font-semibold text-sky-800">next sign: get ready…</div>}
              <div className="text-2xl font-semibold">{label}</div>
              <div className="text-7xl font-bold tabular-nums">{current}</div>
              <div className="text-sm text-zinc-600">target {targetOf(label)}</div>
            </div>
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
          <div className="rounded-xl bg-zinc-100 p-4">
            <div className="text-sm text-zinc-600">last prediction</div>
            <div className="flex items-center gap-2 text-5xl font-bold">
              {token?.label ?? "–"}
              {token?.question && <span className="rounded bg-fuchsia-600 px-2 text-xl text-white">{token.question === "yn" ? "? ja/nein" : "? W-Frage"}</span>}
              {token?.negation && <span className="rounded bg-red-600 px-2 text-xl text-white">¬ nicht</span>}
            </div>
            {token?.top?.map(([l, p]) => (
              <div key={l} className="flex justify-between font-mono text-sm">
                <span>{l}</span>
                <span>{p.toFixed(2)}</span>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-1">
              {history.map((t, i) => (
                <span key={i} className={`rounded px-2 py-0.5 text-sm ${t.label === "?" ? "bg-zinc-300" : "bg-blue-600 text-white"}`}>
                  {t.label}
                  {t.question ? "?" : ""}
                  {t.negation ? "¬" : ""}
                </span>
              ))}
            </div>
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
