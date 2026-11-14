import labels from "@/lib/labels.json";
import type { Turn } from "@/lib/contract";

const TIMEOUT_MS = 4000;
const HISTORY_TURNS = 6;
const MAX_TOKENS = 12;
const VOCABULARY = new Set<string>([...labels.p0, ...labels.p1]);

const SYSTEM_PROMPT = `You turn DGS (German Sign Language) gloss tokens from a deaf caller into ONE spoken German sentence
for a phone call with a medical practice. Answer in German.
Rules:
1. Tokens are DGS glosses: topic/time first, verb last, no articles.
2. Output one short, natural, polite sentence (Sie-Form), as the caller would say it.
3. Use the history to resolve JA/NEIN and references ("Passt Ihnen 15 Uhr?" + JA → "Ja, 15 Uhr passt mir gut.").
4. Never add facts that are not in the tokens or the history: no invented times, dates, names or symptoms.
5. NAME → "Mein Name ist {profile.name}."  WIEDERHOLEN → "Entschuldigung, können Sie das bitte wiederholen?"
6. Number + UHR (+ VORMITTAG/NACHMITTAG/ABEND) → a clock time ("NEUN UHR ABEND" → "21 Uhr").
7. Never give medical advice. Only express what the caller signed.
Return JSON: {"text": "<German sentence>"}`;

// Used when the model is slow or unavailable, so the caller is never left without a voice.
function fallback(tokens: string[]): string {
  const words = tokens.map((t) => t.replace("UE", "ü").replace("OE", "ö").toLowerCase());
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    tokens?: unknown;
    history?: unknown;
    profile?: { name?: unknown };
  } | null;

  const tokens = (Array.isArray(body?.tokens) ? body.tokens : [])
    .filter((t): t is string => typeof t === "string" && VOCABULARY.has(t))
    .slice(0, MAX_TOKENS);
  if (tokens.length === 0) {
    return Response.json({ error: "tokens must contain at least one known label" }, { status: 400 });
  }

  const history: Turn[] = (Array.isArray(body?.history) ? body.history : [])
    .filter((t): t is Turn => (t?.who === "me" || t?.who === "them") && typeof t?.text === "string")
    .slice(-HISTORY_TURNS)
    .map((t) => ({ who: t.who, text: clean(t.text, 300) }));
  const name = clean(body?.profile?.name, 60);

  const { OPENROUTER_API_KEY, LLM_MODEL } = process.env;
  if (!OPENROUTER_API_KEY || !LLM_MODEL) {
    return Response.json({ text: fallback(tokens), fallback: true });
  }

  const input = [
    `History (oldest first; "them" is the practice, "me" is the caller):`,
    ...(history.length ? history.map((t) => `${t.who}: ${t.text}`) : ["(none)"]),
    `profile.name: ${name || "(unknown)"}`,
    `Tokens: ${tokens.join(" ")}`,
  ].join("\n");

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.2,
        max_tokens: 120,
        reasoning: { enabled: false },
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter responded ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const text = clean((JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)) as { text?: unknown }).text, 300);
    if (!text) throw new Error("empty sentence");
    return Response.json({ text });
  } catch (err) {
    console.error("sentence failed:", err instanceof Error ? err.message : err);
    return Response.json({ text: fallback(tokens), fallback: true });
  }
}
