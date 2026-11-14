import json
import os
import re
import time
from collections import deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from core import ROOT, Segmenter, load_labels

DATA = Path(os.environ.get("SIGN_DATA", ROOT / "data"))
P0, P1, NONE = load_labels()
LABELS = [*P0, *P1, NONE]
LOCAL_ORIGIN = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origin_regex=LOCAL_ORIGIN, allow_methods=["GET", "POST"])
saved: list[Path] = []


def origin_ok(origin: str | None) -> bool:
    return origin is None or re.fullmatch(LOCAL_ORIGIN, origin) is not None


def count(label: str) -> int:
    d = DATA / label
    return sum(1 for _ in d.glob("*.json")) if d.is_dir() else 0


def save(label: str, signer: str, seg: list[dict]) -> Path:
    t0 = seg[0]["t"]
    frames = [{"t": f["t"] - t0, "hands": f.get("hands") or [], "pose": f.get("pose")} for f in seg]
    d = DATA / label
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{signer}_{int(time.time() * 1000)}.json"
    sample = {"label": label, "signer": signer, "w": seg[0]["w"], "h": seg[0]["h"], "frames": frames}
    path.write_text(json.dumps(sample, separators=(",", ":")))
    saved.append(path)
    return path


@app.get("/health")
def health():
    return {"ok": True, "model": False, "labels": LABELS, "counts": {lab: count(lab) for lab in LABELS}}


@app.post("/undo")
def undo(request: Request):
    if not origin_ok(request.headers.get("origin")):
        raise HTTPException(403)
    while saved:
        path = saved.pop()
        if path.exists():
            path.unlink()
            return {"label": path.parent.name, "count": count(path.parent.name)}
    raise HTTPException(404, "nothing to undo")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    if not origin_ok(ws.headers.get("origin")):
        await ws.close(code=1008)
        return
    await ws.accept()
    seg = Segmenter()
    mode, label, signer = "infer", None, None
    times: deque[float] = deque()
    last_state, last_status = None, 0.0

    async def error(message: str):
        await ws.send_json({"type": "error", "message": message})

    try:
        while True:
            try:
                m = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                await error("invalid JSON")
                continue
            kind = m.get("type")

            if kind == "frame":
                now = time.monotonic()
                times.append(now)
                while now - times[0] > 1:
                    times.popleft()
                done = seg.push(m)
                if done and mode == "record":
                    save(label, signer, done)
                    await ws.send_json({"type": "recorded", "label": label, "count": count(label)})
                if seg.state != last_state or now - last_status >= 1:
                    last_state, last_status = seg.state, now
                    span = times[-1] - times[0]
                    fps = round((len(times) - 1) / span, 1) if span > 0 else 0.0
                    await ws.send_json({"type": "status", "state": seg.state, "mode": mode, "fps": fps})

            elif kind == "mode":
                seg.reset()
                last_status = 0.0
                if m.get("mode") != "record":
                    mode = "infer"
                    continue
                name = re.sub(r"[^a-z0-9_-]", "", str(m.get("signer") or "").lower())[:32]
                if m.get("label") not in LABELS or not name:
                    mode = "infer"
                    await error(f"record mode needs a known label and a signer, got {m.get('label')!r}/{name!r}")
                else:
                    mode, label, signer = "record", m["label"], name

            elif kind == "reset":
                seg.reset()

            else:
                await error(f"unknown message type {kind!r}")
    except WebSocketDisconnect:
        pass
