import json
import math
import sys
from collections import deque
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
LABELS_FILE = ROOT.parent / "web" / "lib" / "labels.json"

REST_Y = 1.2
START_SPEED = 0.8
END_SPEED = 0.5
START_FRAMES = 2
ENTER_FRAMES = 3
GAP_FRAMES = 3
END_STILL_MS = 250
END_DROP_MS = 130
PRE_ROLL = 6
POST_ROLL = 2
MIN_SEGMENT_MS = 200
MAX_SEGMENT_MS = 3000
EURO_MIN_CUTOFF = 1.0
EURO_BETA = 3.0
EURO_D_CUTOFF = 1.0

L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST = 11, 12, 15, 16
PALM = (0, 5, 9, 17)
SLOTS = ("R", "L")


def load_labels():
    d = json.loads(LABELS_FILE.read_text())
    return d["p0"], d["p1"], d["none"]


class OneEuro:
    """One Euro filter (Casiez et al. 2012): strong smoothing when slow, low lag when fast."""

    def __init__(self):
        self.x = self.dx = self.t = None

    @staticmethod
    def _alpha(cutoff, dt):
        tau = 1 / (2 * math.pi * cutoff)
        return 1 / (1 + tau / dt)

    def __call__(self, x, t):
        if self.t is None:
            self.x, self.dx, self.t = x, np.zeros_like(x), t
            return x
        dt = max((t - self.t) / 1000, 1e-3)
        self.t = t
        a_d = self._alpha(EURO_D_CUTOFF, dt)
        self.dx = a_d * (x - self.x) / dt + (1 - a_d) * self.dx
        a = self._alpha(EURO_MIN_CUTOFF + EURO_BETA * float(np.linalg.norm(self.dx)), dt)
        self.x = a * x + (1 - a) * self.x
        return self.x


def body_frame(frame):
    """Shoulder midpoint and shoulder width in aspect-corrected image coords, or None."""
    pose = frame.get("pose")
    if not pose:
        return None
    aspect = frame["w"] / frame["h"]
    ls = np.array([pose[L_SHOULDER][0] * aspect, pose[L_SHOULDER][1]])
    rs = np.array([pose[R_SHOULDER][0] * aspect, pose[R_SHOULDER][1]])
    sw = float(np.linalg.norm(ls - rs))
    return ((ls + rs) / 2, sw) if sw > 1e-3 else None


def hand_slots(frame, body):
    """Palm centres in shoulder widths relative to the shoulder midpoint (y down), keyed by
    signer side ("R" = signer's right/dominant). Assigned by nearest pose wrist, not handedness."""
    mid, sw = body
    aspect = frame["w"] / frame["h"]
    pose = frame["pose"]
    wrists = {s: np.array([pose[i][0] * aspect, pose[i][1]]) for s, i in (("R", R_WRIST), ("L", L_WRIST))}
    out = {}
    for hand in frame.get("hands") or []:
        lm = hand["lm"]
        palm = np.mean([[lm[i][0] * aspect, lm[i][1]] for i in PALM], axis=0)
        wrist = np.array([lm[0][0] * aspect, lm[0][1]])
        side = min(SLOTS, key=lambda s: np.linalg.norm(wrist - wrists[s]))
        if side in out:
            side = "L" if side == "R" else "R"
        out[side] = (palm - mid) / sw
    return out


class Segmenter:
    """Cuts single signs out of the frame stream. push() returns a finished segment or None.

    A hand is active while it is visible and above the rest line (REST_Y shoulder widths below
    the shoulders). Start: an active hand moves fast or has just entered the signing space, for
    START_FRAMES frames. End: no active hand for END_DROP_MS, or all active hands still for
    END_STILL_MS, or MAX_SEGMENT_MS reached.
    """

    def __init__(self):
        self.ring = deque(maxlen=PRE_ROLL + START_FRAMES)
        self.reset()

    def reset(self):
        self.ring.clear()
        self.filters = {s: OneEuro() for s in SLOTS}
        self.prev = {}
        self.in_space = {s: 0 for s in SLOTS}
        self.missing = {s: 0 for s in SLOTS}
        self.body = None
        self.state = "rest"
        self.seg = []
        self.hot = 0
        self.t_start = 0
        self.last_active = 0
        self.still_since = None
        self.drop_since = None
        self.speed = 0.0

    def measure(self, frame):
        """Returns (any hand in signing space, max speed of those hands, any hand just entered)."""
        self.body = body_frame(frame) or self.body
        if self.body is None:
            return False, 0.0, False
        t = frame["t"]
        hands = hand_slots(frame, self.body) if frame.get("pose") else {}
        active, speed, entered = False, 0.0, False
        for s in SLOTS:
            if s not in hands or hands[s][1] > REST_Y:
                self.missing[s] += 1
                if self.missing[s] > GAP_FRAMES:
                    self.filters[s] = OneEuro()
                    self.prev.pop(s, None)
                    self.in_space[s] = 0
                continue
            self.missing[s] = 0
            p = self.filters[s](hands[s], t)
            if s in self.prev:
                pt, pp = self.prev[s]
                speed = max(speed, float(np.linalg.norm(p - pp)) / max(t - pt, 1) * 1000)
            self.prev[s] = (t, p)
            self.in_space[s] += 1
            active = True
            entered |= self.in_space[s] <= ENTER_FRAMES and speed > END_SPEED
        return active, speed, entered

    def push(self, frame):
        t = frame["t"]
        active, speed, entered = self.measure(frame)
        self.speed = speed
        self.ring.append(frame)

        if self.state == "rest":
            self.hot = self.hot + 1 if active and (speed > START_SPEED or entered) else 0
            if self.hot >= START_FRAMES:
                self.state = "signing"
                self.seg = list(self.ring)
                self.t_start = self.seg[-START_FRAMES]["t"]
                self.last_active = len(self.seg) - 1
                self.still_since = self.drop_since = None
            return None

        self.seg.append(frame)
        moving = active and (speed >= END_SPEED or entered)
        if moving:
            self.last_active = len(self.seg) - 1
        self.still_since = None if moving or not active else (self.still_since or t)
        self.drop_since = None if active else (self.drop_since or t)

        ended = (self.still_since is not None and t - self.still_since >= END_STILL_MS) or (
            self.drop_since is not None and t - self.drop_since >= END_DROP_MS
        )
        if not ended and t - self.t_start < MAX_SEGMENT_MS:
            return None

        seg = self.seg[: self.last_active + 1 + POST_ROLL]
        active_ms = self.seg[self.last_active]["t"] - self.t_start
        self.state, self.seg, self.hot = "rest", [], 0
        return seg if active_ms >= MIN_SEGMENT_MS else None


def replay(path):
    """Replay a SIGN_DUMP stream and print state changes and segments, for tuning."""
    seg = Segmenter()
    frames = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    t0, state, peak = frames[0]["t"], "rest", 0.0
    for f in frames:
        out = seg.push(f)
        peak = max(peak, seg.speed)
        if seg.state != state:
            print(f"{(f['t'] - t0) / 1000:7.2f}s  {state} -> {seg.state}  speed={seg.speed:.2f}")
            state = seg.state
        if out:
            print(f"{(f['t'] - t0) / 1000:7.2f}s  SEGMENT {len(out)} frames, {out[-1]['t'] - out[0]['t']} ms")
    print(f"{len(frames)} frames, peak speed {peak:.2f} sw/s")


if __name__ == "__main__":
    replay(sys.argv[1])
