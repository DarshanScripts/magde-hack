"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import labels from "@/lib/labels.json";
import { SIGN_WS_URL, type SignStatus, type Token } from "@/lib/contract";

const SignCamera = dynamic(() => import("@/components/SignCamera"), { ssr: false });
const SERVICE_URL = SIGN_WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const ALL_LABELS = [...labels.p0, ...labels.p1, labels.none];
const TARGET = 15;

function beep() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.value = 0.1;
  osc.connect(gain).connect(ctx.destination);
  osc.onended = () => ctx.close();
  osc.start();
  osc.stop(ctx.currentTime + 0.12);
}

export default function RecordPage() {
  const [mode, setMode] = useState<"record" | "infer">("infer");
  const [signer, setSigner] = useState("adi");
  const [label, setLabel] = useState(labels.p0[0]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<SignStatus>({ state: "rest", fps: 0, online: false });
  const [token, setToken] = useState<Token | null>(null);
  const [flash, setFlash] = useState(false);

  const refreshCounts = useCallback(async () => {
    try {
      const res = await fetch(`${SERVICE_URL}/health`);
      setCounts((await res.json()).counts);
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
    setCounts((c) => ({ ...c, [lab]: count }));
    beep();
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
  }, []);

  const undo = async () => {
    const res = await fetch(`${SERVICE_URL}/undo`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const { label: lab, count } = await res.json();
      setCounts((c) => ({ ...c, [lab]: count }));
    }
  };

  const nextLabel = () => setLabel(ALL_LABELS[(ALL_LABELS.indexOf(label) + 1) % ALL_LABELS.length]);
  const current = counts[label] ?? 0;
  const btn = "rounded-lg px-3 py-2 font-medium";

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_380px]">
      <SignCamera
        mode={mode}
        recordLabel={label}
        signer={signer}
        onToken={setToken}
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
          service: {status.online ? `online · ${status.fps} fps · ${status.state}` : "offline"}
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
                {Object.entries({ p0: labels.p0, p1: labels.p1, none: [labels.none] }).map(([group, list]) => (
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
              className={`rounded-xl p-4 text-center transition-colors ${flash ? "bg-green-300" : current >= TARGET ? "bg-green-100" : "bg-zinc-100"}`}
            >
              <div className="text-2xl font-semibold">{label}</div>
              <div className="text-7xl font-bold tabular-nums">{current}</div>
              <div className="text-sm text-zinc-600">target {TARGET}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={undo} className={`${btn} flex-1 bg-amber-200`}>
                undo last
              </button>
              <button onClick={nextLabel} className={`${btn} flex-1 bg-zinc-200`}>
                next label
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-xl bg-zinc-100 p-4">
            <div className="text-sm text-zinc-600">last prediction</div>
            <div className="text-5xl font-bold">{token?.label ?? "–"}</div>
            {token?.top?.map(([l, p]) => (
              <div key={l} className="flex justify-between font-mono text-sm">
                <span>{l}</span>
                <span>{p.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="max-h-80 overflow-auto rounded-xl border p-3 font-mono text-sm">
          {ALL_LABELS.map((l) => (
            <div key={l} className={`flex justify-between ${l === label ? "font-bold" : ""}`}>
              <span>{l}</span>
              <span className={(counts[l] ?? 0) >= TARGET ? "text-green-700" : ""}>{counts[l] ?? 0}</span>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}
