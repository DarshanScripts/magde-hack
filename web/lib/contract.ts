export const ROOM_NAME = process.env.LIVEKIT_ROOM ?? "praxis-demo"; // server-side only
export const IDENTITY = { signer: "signer", callee: "callee" } as const;
export const TTS_TRACK_NAME = "tts";
export const MOCK_CONTACTS = [            // fictional, display only — both join ROOM_NAME
  { name: "Hausarztpraxis Dr. Weber", number: "+49 391 0000 001" },
  { name: "Praxis Dr. Schmidt",       number: "+49 391 0000 002" },
];
export const SIGN_WS_URL = process.env.NEXT_PUBLIC_SIGN_WS_URL ?? "ws://localhost:8765/ws";

export type Token = {
  label: string;          // from labels.json or "?"
  conf: number;
  t: number;
  top?: [string, number][];
  question?: "yn" | "wh"; // brows raised = yes/no question, lowered = W-question
  negation?: boolean;     // head shake during the sign
};
export type Turn = { who: "me" | "them"; text: string };
export type Caption = { id: string; who: "me" | "them"; text: string; final: boolean; gloss?: string[] };
export type SignStatus = { state: "rest" | "signing"; fps: number; online: boolean };

export type SignCameraProps = {             // F5 → F9 (the only cross-lane interface)
  mode: "infer" | "record";
  recordLabel?: string;
  signer?: string;
  onToken?: (t: Token) => void;
  onStatus?: (s: SignStatus) => void;
  onRecorded?: (label: string, count: number) => void;
};
