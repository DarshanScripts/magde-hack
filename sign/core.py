import json
import math
import sys
from collections import deque
from pathlib import Path

import numpy as np
import torch
from torch import nn

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


# ---------------------------------------------------------------- features (F7)

MOUTH_KEYS = (
    "jawOpen", "jawForward", "mouthClose", "mouthFunnel", "mouthPucker", "mouthRollLower", "mouthRollUpper",
    "mouthShrugLower", "mouthShrugUpper", "mouthPressLeft", "mouthPressRight", "mouthSmileLeft", "mouthSmileRight",
    "mouthFrownLeft", "mouthFrownRight", "mouthStretchLeft", "mouthStretchRight", "cheekPuff",
)
SEQ_LEN = 32
HAND_DIM = 63 + 4 + 2 + 1
FEAT_DIM = 2 * HAND_DIM + len(MOUTH_KEYS) + 1
MAX_GAP = 3
NOSE = 0


def _fill(a, ok):
    """Forward/backward fill rows of `a` where `ok` is False. Returns None if nothing is valid."""
    if not ok.any():
        return None
    idx = np.where(ok, np.arange(len(ok)), 0)
    np.maximum.accumulate(idx, out=idx)
    first = np.argmax(ok)
    idx[:first] = first
    return a[idx]


def prepare(sample):
    """Raw sample (§6.4) -> per-frame arrays in aspect-corrected image units. None if no pose at all.

    hands: (T, 2, 21, 3), side 0 = signer's right (dominant), 1 = left; present: (T, 2) bool.
    """
    aspect = sample["w"] / sample["h"]
    frames = sample["frames"]
    T = len(frames)
    scale = np.array([aspect, 1.0, aspect])
    t = np.array([f["t"] for f in frames], dtype=float)
    pose = np.zeros((T, 33, 2))
    pose_ok = np.zeros(T, bool)
    for i, f in enumerate(frames):
        if f.get("pose"):
            pose[i] = np.asarray(f["pose"])[:, :2] * scale[:2]
            pose_ok[i] = np.linalg.norm(pose[i, L_SHOULDER] - pose[i, R_SHOULDER]) > 1e-3
    pose = _fill(pose, pose_ok)
    if pose is None:
        return None

    hands = np.zeros((T, 2, 21, 3))
    present = np.zeros((T, 2), bool)
    mouth = np.zeros((T, len(MOUTH_KEYS)))
    face_ok = np.zeros(T)
    for i, f in enumerate(frames):
        wrists = (pose[i, R_WRIST], pose[i, L_WRIST])
        for hand in f.get("hands") or []:
            lm = np.asarray(hand["lm"], dtype=float) * scale
            d = [np.linalg.norm(lm[0, :2] - w) for w in wrists]
            side = int(np.argmin(d))
            if present[i, side]:
                side = 1 - side
                if present[i, side]:
                    continue
            hands[i, side], present[i, side] = lm, True
        face = f.get("face")
        if face and face.get("bs"):
            mouth[i] = [face["bs"].get(k, 0.0) for k in MOUTH_KEYS]
            face_ok[i] = 1.0

    for s in range(2):
        ok = present[:, s]
        idx = np.flatnonzero(ok)
        for a, b in zip(idx[:-1], idx[1:]):
            if 1 < b - a <= MAX_GAP + 1:
                for j in range(a + 1, b):
                    k = (t[j] - t[a]) / max(t[b] - t[a], 1e-6)
                    hands[j, s] = (1 - k) * hands[a, s] + k * hands[b, s]
                    present[j, s] = True
        ok = present[:, s]
        sm = hands[:, s].copy()
        for j in np.flatnonzero(ok):
            nb = [k for k in (j - 1, j, j + 1) if 0 <= k < T and ok[k]]
            sm[j] = hands[nb, s].mean(axis=0)
        hands[:, s] = sm
    return {"t": t, "pose": pose, "hands": hands, "present": present, "mouth": mouth, "face": face_ok}


def augment(p, rng):
    """Random time warp/crop, affine jitter of hands and nose, noise, hand/face dropout. No mirroring."""
    p = {k: v.copy() for k, v in p.items()}
    T = len(p["t"])
    if T > 8:
        a, b = rng.integers(0, 3), T - rng.integers(0, 3)
        p = {k: v[a:b] for k, v in p.items()}
    t = p["t"]
    span = max(t[-1] - t[0], 1.0)
    p["t"] = t + rng.uniform(-0.1, 0.1) * span * np.sin(np.pi * (t - t[0]) / span)

    mid = (p["pose"][:, L_SHOULDER] + p["pose"][:, R_SHOULDER]) / 2
    sw = np.linalg.norm(p["pose"][:, L_SHOULDER] - p["pose"][:, R_SHOULDER], axis=1)
    ang, sc = np.deg2rad(rng.uniform(-10, 10)), rng.uniform(0.9, 1.1)
    R = sc * np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    shift = rng.uniform(-0.05, 0.05, 2)
    xy = p["hands"][..., :2] - mid[:, None, None]
    p["hands"][..., :2] = xy @ R.T + mid[:, None, None] + shift * sw[:, None, None, None]
    p["hands"][..., :2] += rng.normal(0, 0.01, p["hands"][..., :2].shape) * sw[:, None, None, None]
    nose = p["pose"][:, NOSE] - mid
    p["pose"][:, NOSE] = nose @ R.T + mid + shift * sw[:, None]
    if rng.random() < 0.05:
        p["present"][:, 1] = False
    p["mouth"] = np.clip(p["mouth"] * rng.uniform(0.8, 1.2) + rng.normal(0, 0.02, p["mouth"].shape), 0, 1)
    if rng.random() < 0.1:
        p["face"][:] = 0
    return p


def _resample(a, t, tn):
    flat = a.reshape(len(t), -1)
    out = np.stack([np.interp(tn, t, flat[:, j]) for j in range(flat.shape[1])], axis=1)
    return out.reshape((len(tn),) + a.shape[1:])


def encode(p):
    """Prepared arrays -> (SEQ_LEN, FEAT_DIM) feature matrix (not standardised)."""
    t = p["t"]
    if len(t) < 2 or t[-1] <= t[0]:
        t = np.arange(len(t), dtype=float)
    tn = np.linspace(t[0], t[-1], SEQ_LEN)
    hands = p["hands"].copy()
    for s in range(2):
        filled = _fill(hands[:, s], p["present"][:, s])
        if filled is not None:
            hands[:, s] = filled
    hands = _resample(hands, t, tn)
    present = _resample(p["present"].astype(float), t, tn) > 0.5
    pose = _resample(p["pose"], t, tn)
    mouth = _resample(p["mouth"], t, tn)
    face = _resample(p["face"][:, None], t, tn)[:, 0] > 0.5

    mid = (pose[:, L_SHOULDER] + pose[:, R_SHOULDER]) / 2
    sw = np.maximum(np.linalg.norm(pose[:, L_SHOULDER] - pose[:, R_SHOULDER], axis=1), 1e-3)
    nose = pose[:, NOSE]
    parts = []
    for s in range(2):
        h = hands[:, s]
        size = np.maximum(np.linalg.norm(h[:, 9, :2] - h[:, 0, :2], axis=1), 1e-3)
        shape = (h - h[:, :1]) / size[:, None, None]
        shape[..., 2] *= 0.5
        loc = np.concatenate([(h[:, 0, :2] - mid) / sw[:, None], (h[:, 0, :2] - nose) / sw[:, None]], axis=1)
        vel = np.diff(loc[:, :2], axis=0, prepend=loc[:1, :2])
        f = np.concatenate([shape.reshape(SEQ_LEN, -1), loc, vel, np.ones((SEQ_LEN, 1))], axis=1)
        f[~present[:, s]] = 0
        parts.append(f)
    mouth[~face] = 0
    parts += [mouth, face[:, None].astype(float)]
    return np.concatenate(parts, axis=1).astype(np.float32)


def features(sample):
    p = prepare(sample)
    return None if p is None else encode(p)


# ---------------------------------------------------------------- model (F7/F8)

MODELS = ROOT / "models"


class CNN1D(nn.Module):
    """Linear(F->C) -> 3x residual [Conv1d k5 -> BN -> GELU -> Dropout] -> avg+max pool -> Linear."""

    def __init__(self, feat_dim, n_classes, width=128, dropout=0.2):
        super().__init__()
        self.inp = nn.Linear(feat_dim, width)
        self.blocks = nn.ModuleList(
            nn.Sequential(nn.Conv1d(width, width, 5, padding=2), nn.BatchNorm1d(width), nn.GELU(), nn.Dropout(dropout))
            for _ in range(3)
        )
        self.out = nn.Linear(2 * width, n_classes)

    def forward(self, x):
        h = self.inp(x).transpose(1, 2)
        for b in self.blocks:
            h = h + b(h)
        return self.out(torch.cat([h.mean(2), h.amax(2)], 1))


def knn_probs(x, templates, labels, n_classes, temp):
    """Softmax over negative nearest-template distance per class. x: (N, D), templates: (M, D)."""
    d = torch.cdist(torch.as_tensor(x), torch.as_tensor(templates))
    best = torch.full((len(x), n_classes), float("inf"))
    lab = torch.as_tensor(labels)
    for c in range(n_classes):
        m = lab == c
        if m.any():
            best[:, c] = d[:, m].min(1).values
    return torch.softmax(-best / temp, 1).numpy()


class Recognizer:
    """Loads models/ (config.json + model.pt or knn.npz) and classifies raw segments."""

    def __init__(self, folder=MODELS):
        cfg_path = Path(folder) / "config.json"
        self.cfg = json.loads(cfg_path.read_text())
        self.mtime = cfg_path.stat().st_mtime
        self.labels = self.cfg["labels"]
        self.mean = np.asarray(self.cfg["mean"], np.float32)
        self.std = np.asarray(self.cfg["std"], np.float32)
        if self.cfg["arch"] == "cnn1d":
            self.net = CNN1D(self.cfg["feat_dim"], len(self.labels), self.cfg.get("width", 128))
            self.net.load_state_dict(torch.load(Path(folder) / "model.pt", map_location="cpu", weights_only=True))
            self.net.eval()
        else:
            k = np.load(Path(folder) / "knn.npz")
            self.templates, self.tlabels = k["templates"], k["labels"]

    def probs(self, x):
        """x: (N, SEQ_LEN, FEAT_DIM) unstandardised -> (N, classes)."""
        z = (x - self.mean) / self.std
        if self.cfg["arch"] == "cnn1d":
            with torch.no_grad():
                return torch.softmax(self.net(torch.as_tensor(z)), 1).numpy()
        return knn_probs(z.reshape(len(z), -1), self.templates, self.tlabels, len(self.labels), self.cfg["temp"])

    def predict(self, sample):
        """Returns (label or "?", conf, top3) for a raw sample dict (w, h, frames)."""
        x = features(sample)
        if x is None:
            return "?", 0.0, []
        pr = self.probs(x[None])[0]
        order = np.argsort(-pr)
        top = [(self.labels[i], round(float(pr[i]), 3)) for i in order[:3]]
        label, conf = top[0]
        margin = conf - (top[1][1] if len(top) > 1 else 0.0)
        if label == self.cfg["none"] or conf < self.cfg["threshold"] or margin < self.cfg["margin"]:
            label = "?"
        return label, conf, top
