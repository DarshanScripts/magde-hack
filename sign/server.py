import json
import os
import re
import time
from collections import deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from core import MODELS, ROOT, NonManual, Recognizer, Segmenter, load_labels

DATA = Path(os.environ.get("SIGN_DATA", ROOT / "data"))
DUMP = os.environ.get("SIGN_DUMP")
P0, P1, NONE = load_labels()
LABELS = [*P0, *P1, NONE]
LOCAL_ORIGIN = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
REPEAT_MS = 400
model: Recognizer | None = None

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origin_regex=LOCAL_ORIGIN, allow_methods=["GET", "POST"])
saved: list[Path] = []


def load_model() -> Recognizer | None:
    """Loads sign/models/ if present; reloads when config.json changed (after retraining)."""
    global model
    cfg = MODELS / "config.json"
    if not cfg.exists():
        model = None
    elif model is None or cfg.stat().st_mtime != model.mtime:
        model = Recognizer()
        print(f"loaded model: {model.cfg['arch']}, {len(model.labels)} labels, trained {model.cfg.get('trained')}")
    return model


load_model()


def origin_ok(origin: str | None) -> bool:
    return origin is None or re.fullmatch(LOCAL_ORIGIN, origin) is not None


def count(label: str) -> int:
    d = DATA / label
    return sum(1 for _ in d.glob("*.json")) if d.is_dir() else 0


def save(label: str, signer: str, seg: list[dict]) -> Path:
    t0 = seg[0]["t"]
    frames = [{"t": f["t"] - t0, "hands": f.get("hands") or [], "pose": f.get("pose"), "face": f.get("face")} for f in seg]
    d = DATA / label
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{signer}_{int(time.time() * 1000)}.json"
    sample = {"label": label, "signer": signer, "w": seg[0]["w"], "h": seg[0]["h"], "frames": frames}
    path.write_text(json.dumps(sample, separators=(",", ":")))
    saved.append(path)
    return path


@app.get("/health")
def health():
    return {"ok": True, "model": model is not None, "labels": LABELS, "counts": {lab: count(lab) for lab in LABELS}}


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
    rec = load_model()
    seg = Segmenter()
    nm = NonManual()
    last_token = ("", 0)
    mode, label, signer = "infer", None, None
    times: deque[float] = deque()
    last_state, last_status = None, 0.0
    dump = open(DUMP, "a") if DUMP else None

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
                if dump:
                    dump.write(json.dumps(m, separators=(",", ":")) + "\n")
                now = time.monotonic()
                times.append(now)
                while now - times[0] > 1:
                    times.popleft()
                done = seg.push(m)
                if seg.state == "rest" and not done:
                    nm.observe_rest(m)
                if done and mode == "record":
                    save(label, signer, done)
                    await ws.send_json({"type": "recorded", "label": label, "count": count(label)})
                elif done and rec is None:
                    await error("model not loaded")
                elif done:
                    w_h = {"w": done[0]["w"], "h": done[0]["h"]}
                    lab, conf, top = rec.predict({**w_h, "frames": done})
                    question, negation = nm.analyse(done)
                    t_end = done[-1]["t"]
                    if lab != last_token[0] or t_end - last_token[1] > REPEAT_MS:
                        tok = {"type": "token", "label": lab, "conf": conf, "t": t_end, "top": top}
                        if question:
                            tok["question"] = question
                        if negation:
                            tok["negation"] = True
                        await ws.send_json(tok)
                    last_token = (lab, t_end)
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
    finally:
        if dump:
            dump.close()
