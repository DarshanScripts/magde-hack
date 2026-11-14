"use client";

import { MOCK_CONTACTS } from "@/lib/contract";
import CallTimer from "./CallTimer";
import LatticeLoader from "./reactbits/LatticeLoader";
import { ChevronIcon, HangUpIcon, PhoneIcon } from "./icons";

export type CallPhase = "idle" | "connecting" | "ringing" | "connected";

export default function DialBar({
  phase,
  contact,
  onContact,
  onDial,
  onHangUp,
}: {
  phase: CallPhase;
  contact: number;
  onContact(index: number): void;
  onDial(): void;
  onHangUp(): void;
}) {
  const { name, number } = MOCK_CONTACTS[contact];

  return (
    <div className="flex h-[72px] w-full max-w-2xl items-center gap-3 rounded-full border border-line bg-surface p-2.5 pl-3 shadow-float">
      <span
        className={`flex size-[52px] shrink-0 items-center justify-center rounded-full text-lg font-medium transition-colors duration-300 ${
          phase === "connected" ? "bg-call-soft text-call" : "bg-sunken text-ink"
        }`}
        aria-hidden="true"
      >
        {name.replace(/^(Hausarztpraxis|Praxis)\s+(Dr\.\s+)?/, "").charAt(0)}
      </span>

      {phase === "idle" ? (
        <label className="relative flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-muted">Anrufen bei</span>
          <select
            value={contact}
            onChange={(e) => onContact(Number(e.target.value))}
            className="w-full cursor-pointer appearance-none truncate bg-transparent pr-8 text-base font-medium outline-none"
          >
            {MOCK_CONTACTS.map((c, i) => (
              <option key={c.number} value={i}>
                {c.name} · {c.number}
              </option>
            ))}
          </select>
          <ChevronIcon className="pointer-events-none absolute right-1 bottom-0.5 text-muted" />
        </label>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium">{name}</span>
          <span className="flex h-5 items-center gap-2 text-sm text-muted">
            {phase === "connected" ? (
              <>
                <span className="size-1.5 rounded-full bg-call" />
                <span>Verbunden</span>
                <CallTimer className="text-ink" />
              </>
            ) : (
              <LatticeLoader
                label={phase === "connecting" ? "Verbinde" : "Ruft an"}
                pattern="ripple"
                cellSize={3}
                gap={2}
                showTimer={false}
                color="var(--color-accent)"
              />
            )}
            <span className="sr-only">{number}</span>
          </span>
        </div>
      )}

      {phase === "idle" ? (
        <button
          key="dial"
          type="button"
          onClick={onDial}
          className="flex h-[52px] shrink-0 cursor-pointer items-center gap-2 rounded-full bg-call px-6 text-base font-medium text-white transition duration-200 ease-out-soft hover:brightness-105 active:scale-[0.97]"
        >
          <PhoneIcon />
          <span>Anrufen</span>
        </button>
      ) : (
        <button
          key="hangup"
          type="button"
          onClick={onHangUp}
          className="flex h-[52px] shrink-0 cursor-pointer items-center gap-2 rounded-full bg-danger px-6 text-base font-medium text-white transition duration-200 ease-out-soft hover:brightness-105 active:scale-[0.97]"
        >
          <HangUpIcon />
          <span>Auflegen</span>
        </button>
      )}
    </div>
  );
}
