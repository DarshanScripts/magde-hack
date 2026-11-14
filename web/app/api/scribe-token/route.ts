import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Single-use and valid for 15 minutes, so the browser asks for a new one on every (re)connect.
export async function GET() {
  const { ELEVEN_LABS_API_KEY } = process.env;
  if (!ELEVEN_LABS_API_KEY) {
    return Response.json({ error: "ElevenLabs is not configured" }, { status: 500 });
  }
  try {
    const elevenlabs = new ElevenLabsClient({ apiKey: ELEVEN_LABS_API_KEY });
    const { token } = await elevenlabs.tokens.singleUse.create("realtime_scribe");
    return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("scribe token failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "could not create a transcription token" }, { status: 502 });
  }
}
