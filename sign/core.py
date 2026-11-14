import json
from collections import deque
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
LABELS_FILE = ROOT.parent / "web" / "lib" / "labels.json"

START_SPEED = 0.5
END_SPEED = 0.25
START_FRAMES = 3
END_STILL_MS = 300
END_NO_HANDS_MS = 300
PRE_ROLL = 5
POST_ROLL = 3
MIN_SEGMENT_MS = 250
MAX_SEGMENT_MS = 3000
SPEED_LAG = 3
SMOOTH = 0.5

L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST = 11, 12, 15, 16


def load_labels():
    d = json.loads(LABELS_FILE.read_text())
    return d["p0"], d["p1"], d["none"]


def _xy(p, aspect):
    return np.array([p[0] * aspect, p[1]])


def dominant_wrist(frame):
    """Signer's right (dominant) wrist in aspect-corrected image coords, plus shoulder width.

    Hands are assigned by the nearest pose wrist; MediaPipe handedness is not trusted.
    Returns (None, sw) if the dominant hand is not visible, (None, None) without pose.
    """
    pose = frame.get("pose")
    if not pose:
        return None, None
    aspect = frame["w"] / frame["h"]
    sw = float(np.linalg.norm(_xy(pose[L_SHOULDER], aspect) - _xy(pose[R_SHOULDER], aspect)))
    if sw < 1e-3:
        return None, None
    right, left = _xy(pose[R_WRIST], aspect), _xy(pose[L_WRIST], aspect)
    best = None
    for hand in frame.get("hands") or []:
        w = _xy(hand["lm"][0], aspect)
        dr, dl = np.linalg.norm(w - right), np.linalg.norm(w - left)
        if dr <= dl and (best is None or dr < best[0]):
            best = (dr, w)
    return (best[1] if best else None), sw


class Segmenter:
    """Cuts single signs out of the frame stream. push() returns a finished segment or None."""

    def __init__(self):
        self.ring = deque(maxlen=PRE_ROLL + START_FRAMES)
        self.hist = deque(maxlen=SPEED_LAG + 1)
        self.reset()

    def reset(self):
        self.ring.clear()
        self.hist.clear()
        self.ema = None
        self.state = "rest"
        self.seg = []
        self.fast = 0
        self.need_rest = False
        self.t_start = 0
        self.last_active = 0
        self.still_since = None
        self.nohands_since = None

    def speed(self, frame):
        """Dominant wrist speed in shoulder widths per second; None if the hand is not visible."""
        pos, sw = dominant_wrist(frame)
        if pos is None:
            self.ema = None
            self.hist.clear()
            return None
        self.ema = pos if self.ema is None else SMOOTH * pos + (1 - SMOOTH) * self.ema
        self.hist.append((frame["t"], self.ema))
        if len(self.hist) <= SPEED_LAG:
            return 0.0
        (t0, p0), (t1, p1) = self.hist[0], self.hist[-1]
        return float(np.linalg.norm(p1 - p0) / sw / max(t1 - t0, 1) * 1000)

    def push(self, frame):
        t = frame["t"]
        v = self.speed(frame)
        moving = v is not None and v >= END_SPEED
        self.ring.append(frame)

        if self.state == "rest":
            if self.need_rest:
                self.need_rest = moving
                return None
            self.fast = self.fast + 1 if v is not None and v > START_SPEED else 0
            if self.fast >= START_FRAMES:
                self.state = "signing"
                self.seg = list(self.ring)
                self.t_start = self.seg[-START_FRAMES]["t"]
                self.last_active = len(self.seg) - 1
                self.still_since = self.nohands_since = None
            return None

        self.seg.append(frame)
        if moving:
            self.last_active = len(self.seg) - 1
            self.still_since = None
        elif self.still_since is None:
            self.still_since = t
        if frame.get("hands"):
            self.nohands_since = None
        elif self.nohands_since is None:
            self.nohands_since = t

        ended = (self.still_since is not None and t - self.still_since >= END_STILL_MS) or (
            self.nohands_since is not None and t - self.nohands_since >= END_NO_HANDS_MS
        )
        forced = t - self.t_start >= MAX_SEGMENT_MS
        if not (ended or forced):
            return None

        seg = self.seg[: self.last_active + 1 + POST_ROLL]
        active_ms = self.seg[self.last_active]["t"] - self.t_start
        self.state, self.seg, self.fast = "rest", [], 0
        self.need_rest = forced and not ended
        return seg if active_ms >= MIN_SEGMENT_MS else None
