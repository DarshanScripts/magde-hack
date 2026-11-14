import type { NextRequest } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { IDENTITY, ROOM_NAME } from "@/lib/contract";

export async function GET(request: NextRequest) {
  const identity = request.nextUrl.searchParams.get("identity");
  if (identity !== IDENTITY.signer && identity !== IDENTITY.callee) {
    return Response.json({ error: "identity must be signer or callee" }, { status: 400 });
  }
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return Response.json({ error: "LiveKit is not configured" }, { status: 500 });
  }

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: "1h" });
  at.addGrant({ room: ROOM_NAME, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });

  return Response.json(
    { token: await at.toJwt(), url: LIVEKIT_URL },
    { headers: { "Cache-Control": "no-store" } },
  );
}
