import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const MAX_CHARS = 500;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_CHARS) {
    return Response.json({ error: `text must be 1-${MAX_CHARS} characters` }, { status: 400 });
  }
  const { ELEVEN_LABS_API_KEY, ELEVEN_LABS_VOICE_ID } = process.env;
  if (!ELEVEN_LABS_API_KEY || !ELEVEN_LABS_VOICE_ID) {
    return Response.json({ error: "ElevenLabs is not configured" }, { status: 500 });
  }

  try {
    const elevenlabs = new ElevenLabsClient({ apiKey: ELEVEN_LABS_API_KEY });
    const audio = await elevenlabs.textToSpeech.stream(ELEVEN_LABS_VOICE_ID, {
      text,
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
      languageCode: "de",
    });
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("tts failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "text-to-speech failed" }, { status: 502 });
  }
}
