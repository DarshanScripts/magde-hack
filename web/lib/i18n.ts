"use client";

import { useSyncExternalStore } from "react";

// Interface text only. The spoken voice and the conversation itself stay German.
const de = {
  tagline: "Gebärden werden zur Stimme. Sprache wird zu Text.",
  practicePage: "Praxis-Seite",
  cameraOff: "Kamera aus",
  signCamera: "Gebärdenkamera",
  cameraHint: "Hier erscheint Ihr Kamerabild, sobald die Gebärdenerkennung angeschlossen ist.",
  recognizedSigns: "Erkannte Gebärden",
  noneYet: "noch keine",
  conversation: "Gespräch",
  practice: "Praxis",
  yourVoice: "Ihre Stimme",
  captionsConnecting: "Untertitel starten …",
  captionsLive: "Untertitel aktiv",
  captionsFailed: "Untertitel nicht verfügbar",
  emptyConnected: "Verbunden. Schreiben Sie unten einen Satz, er wird der Praxis vorgelesen. Was die Praxis sagt, erscheint hier als Text.",
  emptyIdle: "Wählen Sie unten eine Praxis und starten Sie den Anruf.",
  emptyCalling: "{name} wird angerufen. Die Praxis muss auf ihrem Gerät die Praxis-Seite öffnen und beitreten.",
  inputConnected: "Satz eingeben, der vorgelesen wird",
  inputIdle: "Erst im Anruf verfügbar",
  inputLabel: "Satz, der vorgelesen wird",
  say: "Sagen",
  speaking: "wird gesprochen …",
  callTo: "Anrufen bei",
  call: "Anrufen",
  hangUp: "Auflegen",
  connected: "Verbunden",
  connecting: "Verbinde",
  ringing: "Ruft an",
  practiceHungUp: "Die Praxis hat aufgelegt.",
  connectionLost: "Die Verbindung wurde getrennt.",
  duplicateSigner:
    "Ein anderes Gerät hat diese Anrufer-Seite geöffnet und den Anruf übernommen. Das zweite Gerät muss /callee öffnen.",
  duplicateCallee: "Ein anderes Gerät hat die Praxis-Seite geöffnet und den Anruf übernommen.",
  ttsFailed: "Die Sprachausgabe ist fehlgeschlagen.",
  sentenceFailed: "Der Satz konnte nicht gebildet werden.",
  mockHint: "Testmodus: Tippen Sie im Anruf auf Gebärden. Nach 1,5 Sekunden Pause wird daraus ein Satz gesprochen.",
  chipKeys: "Enter = sagen · Backspace = letzte löschen · Esc = alle löschen",
  confirmMode: "Vor dem Sprechen bestätigen",
  confirmKeys: "Enter = sagen · Esc = verwerfen",
  awaitingConfirm: "wartet auf Bestätigung",
  discard: "Verwerfen",
  yourName: "Ihr Name",
  notSecure: "Diese Adresse ist nicht sicher (kein HTTPS). Bitte die https-Adresse von ngrok oder localhost öffnen.",
  micDenied: "Bitte erlauben Sie den Zugriff auf das Mikrofon.",
  micMissing: "Es wurde kein nutzbares Mikrofon gefunden.",
  connectFailed: "Verbindung fehlgeschlagen: {detail}",
  calleeIdleTitle: "Anruf annehmen",
  calleeWaitingTitle: "Warte auf Anruf …",
  calleeReady: "Sie sind bereit. Das Mikrofon ist an.",
  calleeIdleSub: "Praxis-Seite für eingehende Anrufe",
  calleeInfo:
    "Die anrufende Person gebärdet in Deutscher Gebärdensprache. Sie hören ihre Sätze als Computerstimme. Sprechen Sie ganz normal, Ihre Antwort wird als Text angezeigt.",
  muted: "Stumm",
  micOn: "Mikrofon an",
  join: "Beitreten",
  language: "Sprache der Oberfläche",
};

const en: typeof de = {
  tagline: "Signs become a voice. Speech becomes text.",
  practicePage: "Practice page",
  cameraOff: "Camera off",
  signCamera: "Sign camera",
  cameraHint: "Your camera image appears here once sign recognition is connected.",
  recognizedSigns: "Recognized signs",
  noneYet: "none yet",
  conversation: "Conversation",
  practice: "Practice",
  yourVoice: "Your voice",
  captionsConnecting: "Captions starting …",
  captionsLive: "Captions on",
  captionsFailed: "Captions unavailable",
  emptyConnected: "Connected. Type a sentence below and it is read out to the practice in German. What the practice says appears here as text.",
  emptyIdle: "Choose a practice below and start the call.",
  emptyCalling: "Calling {name}. The practice has to open the practice page on its device and join.",
  inputConnected: "Type a sentence to be spoken",
  inputIdle: "Available during a call",
  inputLabel: "Sentence to be spoken",
  say: "Speak",
  speaking: "speaking …",
  callTo: "Call",
  call: "Call",
  hangUp: "Hang up",
  connected: "Connected",
  connecting: "Connecting",
  ringing: "Ringing",
  practiceHungUp: "The practice hung up.",
  connectionLost: "The connection was lost.",
  duplicateSigner:
    "Another device opened this caller page and took over the call. The second device has to open /callee instead.",
  duplicateCallee: "Another device opened the practice page and took over the call.",
  ttsFailed: "Text-to-speech failed.",
  sentenceFailed: "The sentence could not be created.",
  mockHint: "Test mode: tap signs during a call. After a 1.5 second pause they are spoken as one sentence.",
  chipKeys: "Enter = speak · Backspace = remove last · Esc = clear",
  confirmMode: "Confirm before speaking",
  confirmKeys: "Enter = speak · Esc = discard",
  awaitingConfirm: "waiting for confirmation",
  discard: "Discard",
  yourName: "Your name",
  notSecure: "This address is not secure (no HTTPS). Open the ngrok https address or localhost instead.",
  micDenied: "Please allow access to the microphone.",
  micMissing: "No usable microphone was found.",
  connectFailed: "Connection failed: {detail}",
  calleeIdleTitle: "Answer the call",
  calleeWaitingTitle: "Waiting for the call …",
  calleeReady: "You are ready. The microphone is on.",
  calleeIdleSub: "Practice page for incoming calls",
  calleeInfo:
    "The caller signs in German Sign Language. You hear their sentences as a computer voice. Just speak normally, your answer is shown to them as text.",
  muted: "Muted",
  micOn: "Microphone on",
  join: "Join",
  language: "Interface language",
};

const dict = { de, en };
export type Lang = keyof typeof dict;
export type TextKey = keyof typeof de;
export type Translate = (key: TextKey, vars?: Record<string, string>) => string;

const STORAGE_KEY = "dgs-call-lang";
const listeners = new Set<() => void>();

function currentLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "de" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setLang(lang: Lang) {
  localStorage.setItem(STORAGE_KEY, lang);
  listeners.forEach((l) => l());
}

export function useI18n(): { lang: Lang; t: Translate } {
  const lang = useSyncExternalStore(subscribe, currentLang, () => "de" as Lang);
  const t: Translate = (key, vars) =>
    dict[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => vars?.[name] ?? "");
  return { lang, t };
}
