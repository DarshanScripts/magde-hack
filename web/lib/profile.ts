"use client";

import { useSyncExternalStore } from "react";

// The caller's name, used when they sign NAME. Kept in this browser only.
const KEY = "dgs-call-name";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function setProfileName(name: string) {
  localStorage.setItem(KEY, name);
  listeners.forEach((l) => l());
}

export function useProfileName(): string {
  return useSyncExternalStore(subscribe, () => localStorage.getItem(KEY) ?? "", () => "");
}

const noop = () => () => {};

// `/?mock=1` shows a button per sign label, so the loop runs without a camera or the sign service.
export function useMockMode(): boolean {
  return useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).has("mock"), () => false);
}
