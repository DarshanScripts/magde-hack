"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CONTACT_PHOTOS } from "@/lib/contacts";
import { MOCK_CONTACTS } from "@/lib/contract";
import { useI18n } from "@/lib/i18n";
import CallTimer from "./CallTimer";
import LatticeLoader from "./reactbits/LatticeLoader";
import { CheckIcon, ChevronIcon, HangUpIcon, PhoneIcon } from "./icons";

export type CallPhase = "idle" | "connecting" | "ringing" | "connected";

function Avatar({ photo, size, live = false }: { photo: StaticImageData; size: number; live?: boolean }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <Image
        src={photo}
        alt=""
        width={size}
        height={size}
        className={`size-full rounded-full object-cover ring-2 ring-offset-2 ring-offset-surface transition-[box-shadow] duration-300 ${
          live ? "ring-call" : "ring-transparent"
        }`}
      />
      {live && <span className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-surface bg-call" />}
    </span>
  );
}

function ContactPicker({ contact, onContact }: { contact: number; onContact(index: number): void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(contact);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const { name, number } = MOCK_CONTACTS[contact];

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function toggle() {
    setActive(contact);
    setOpen((o) => !o);
  }

  function choose(i: number) {
    onContact(i);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    const n = MOCK_CONTACTS.length;
    if (e.key === "ArrowDown") setActive((a) => (a + 1) % n);
    else if (e.key === "ArrowUp") setActive((a) => (a - 1 + n) % n);
    else if (e.key === "Enter" || e.key === " ") choose(active);
    else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
    else return;
    e.preventDefault();
  }

  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-full py-1 pr-3 pl-1 text-left transition-colors duration-200 hover:bg-sunken/60"
      >
        <Avatar photo={CONTACT_PHOTOS[contact]} size={52} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-muted">{t("callTo")}</span>
          <span className="truncate text-base font-medium">{name}</span>
          <span className="sr-only">{number}</span>
        </span>
        <ChevronIcon className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute bottom-[calc(100%+14px)] left-0 z-20 w-[min(420px,calc(100vw-2rem))] origin-bottom-left rounded-[24px] border border-line bg-surface p-2 shadow-float transition duration-150 ease-out starting:translate-y-1 starting:opacity-0">
          <p className="px-3 pt-1.5 pb-2 text-xs text-muted">{t("chooseContact")}</p>
          <ul
            ref={list}
            role="listbox"
            tabIndex={-1}
            aria-label={t("chooseContact")}
            aria-activedescendant={`contact-${active}`}
            onKeyDown={onKeyDown}
            className="flex flex-col gap-1 outline-none"
          >
            {MOCK_CONTACTS.map((c, i) => (
              <li
                key={c.number}
                id={`contact-${i}`}
                role="option"
                aria-selected={i === contact}
                onClick={() => choose(i)}
                onPointerEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl px-2.5 py-2 transition-colors duration-150 ${
                  i === active ? "bg-sunken/70" : ""
                }`}
              >
                <Avatar photo={CONTACT_PHOTOS[i]} size={44} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-medium">{c.name}</span>
                  <span className="font-mono text-xs text-muted">{c.number}</span>
                </span>
                {i === contact && <CheckIcon className="shrink-0 text-accent" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

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
  const { t } = useI18n();

  return (
    <div className="relative flex h-[76px] w-full max-w-2xl items-center gap-3 rounded-full border border-line bg-surface p-2.5 pl-2.5 shadow-float">
      {phase === "idle" ? (
        <ContactPicker contact={contact} onContact={onContact} />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 pl-1">
          <Avatar photo={CONTACT_PHOTOS[contact]} size={52} live={phase === "connected"} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-medium">{name}</span>
            <span className="flex h-5 items-center gap-2 text-sm text-muted">
              {phase === "connected" ? (
                <>
                  <span>{t("connected")}</span>
                  <CallTimer className="text-ink" />
                </>
              ) : (
                <LatticeLoader
                  label={t(phase === "connecting" ? "connecting" : "ringing")}
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
          <span>{t("call")}</span>
        </button>
      ) : (
        <button
          key="hangup"
          type="button"
          onClick={onHangUp}
          className="flex h-[52px] shrink-0 cursor-pointer items-center gap-2 rounded-full bg-danger px-6 text-base font-medium text-white transition duration-200 ease-out-soft hover:brightness-105 active:scale-[0.97]"
        >
          <HangUpIcon />
          <span>{t("hangUp")}</span>
        </button>
      )}
    </div>
  );
}
