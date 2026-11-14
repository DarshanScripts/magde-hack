"use client";

import { useEffect, useRef } from "react";
import type { Caption } from "@/lib/contract";
import { useI18n } from "@/lib/i18n";

export default function Captions({
  captions,
  empty,
  awaitingId,
}: {
  captions: Caption[];
  empty: React.ReactNode;
  awaitingId?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [captions]);

  if (captions.length === 0) {
    return <div className="flex flex-1 items-center justify-center px-8 text-center">{empty}</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5" aria-live="polite">
      <ul className="flex flex-col gap-3">
        {captions.map((c) => (
          <li
            key={c.id}
            className={`flex animate-rise flex-col gap-1 ${c.who === "me" ? "items-end" : "items-start"}`}
          >
            <p
              className={`max-w-[85%] rounded-3xl px-5 py-3 text-xl leading-snug transition-opacity duration-300 ${
                c.who === "me"
                  ? "rounded-br-lg bg-accent text-white"
                  : "rounded-bl-lg bg-sunken text-ink"
              } ${c.final ? "" : "opacity-60"}`}
            >
              {c.text}
            </p>
            {c.gloss?.length ? (
              <span className="px-2 font-mono text-xs tracking-wide text-muted">{c.gloss.join(" · ")}</span>
            ) : null}
            {c.who === "me" && !c.final ? (
              <span className="px-2 text-xs text-muted">{t(c.id === awaitingId ? "awaitingConfirm" : "speaking")}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <div ref={end} />
    </div>
  );
}
