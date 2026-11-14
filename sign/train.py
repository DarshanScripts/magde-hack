"""Train the sign classifier from sign/data and write sign/models/.

python train.py [--holdout-signer NAME] [--epochs 120] [--no-final]

Hold-out: samples of --holdout-signer, else the last 3 samples (by time) per label.
Trains a 1-NN baseline and a 1D-CNN on identical features, picks the better one on the
hold-out set, chooses the rejection threshold/margin there, then (unless --no-final)
retrains the chosen model on all samples.
"""

import argparse
import json
import os
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn

from core import CNN1D, FEAT_DIM, MODELS, ROOT, SEQ_LEN, augment, encode, knn_probs, load_labels, prepare

DATA = Path(os.environ.get("SIGN_DATA", ROOT / "data"))
OUT = MODELS
MIN_SAMPLES = 3
HOLDOUT_LAST = 3
AUG_PER_SAMPLE = 30
TARGET_PASS = 0.9
MAX_THRESHOLD = 0.7
MAX_MARGIN = 0.3


def load(labels):
    items = []
    for lab in labels:
        for f in sorted((DATA / lab).glob("*.json")) if (DATA / lab).is_dir() else []:
            s = json.loads(f.read_text())
            p = prepare(s)
            if p is not None and len(p["t"]) >= 4:
                items.append({"label": lab, "signer": s.get("signer", ""), "file": f.name, "p": p})
    return items


def split(items, holdout_signer):
    if holdout_signer:
        return [i for i in items if i["signer"] != holdout_signer], [i for i in items if i["signer"] == holdout_signer]
    by = defaultdict(list)
    for i in items:
        by[i["label"]].append(i)
    train, test = [], []
    for lab, lst in by.items():
        lst.sort(key=lambda i: i["file"].rsplit("_", 1)[-1])
        k = HOLDOUT_LAST if len(lst) > HOLDOUT_LAST + 2 else 0
        train += lst[: len(lst) - k]
        test += lst[len(lst) - k:]
    return train, test


def build(items, classes, rng, n_aug):
    xs, ys = [], []
    for i in items:
        y = classes.index(i["label"])
        xs.append(encode(i["p"]))
        ys.append(y)
        for _ in range(n_aug):
            xs.append(encode(augment(i["p"], rng)))
            ys.append(y)
    return np.stack(xs), np.array(ys)


def standardiser(x):
    flat = x.reshape(-1, x.shape[-1])
    return flat.mean(0), np.maximum(flat.std(0), 1e-3)


def train_cnn(x, y, n_classes, epochs, device, seed=0):
    torch.manual_seed(seed)
    net = CNN1D(FEAT_DIM, n_classes).to(device)
    opt = torch.optim.AdamW(net.parameters(), lr=1e-3, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=epochs * max(1, -(-len(x) // 64)))
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)
    xt, yt = torch.as_tensor(x, device=device), torch.as_tensor(y, device=device)
    net.train()
    for _ in range(epochs):
        perm = torch.randperm(len(xt), device=device)
        for b in range(0, len(xt), 64):
            idx = perm[b:b + 64]
            if len(idx) < 2:
                continue
            opt.zero_grad()
            loss_fn(net(xt[idx]), yt[idx]).backward()
            opt.step()
            sched.step()
    return net.eval().cpu()


def cnn_probs(net, x):
    with torch.no_grad():
        return torch.softmax(net(torch.as_tensor(x)), 1).numpy()


def knn_temp(x_tr, y_tr, n_classes):
    """Temperature = median nearest-neighbour distance between different training originals."""
    d = torch.cdist(torch.as_tensor(x_tr), torch.as_tensor(x_tr)).numpy()
    np.fill_diagonal(d, np.inf)
    return float(np.median(d.min(1))) or 1.0


def choose_rejection(probs, y, none_idx):
    top = np.sort(probs, 1)[:, ::-1]
    pred = probs.argmax(1)
    conf, margin = top[:, 0], top[:, 0] - top[:, 1]
    correct = (pred == y) & (pred != none_idx)
    wrong = (pred != y) & (pred != none_idx)
    best = (0.0, 0.0, -1.0, 0.0)
    for th in np.arange(0.0, MAX_THRESHOLD + 1e-9, 0.05):
        for mg in np.arange(0.0, MAX_MARGIN + 1e-9, 0.05):
            ok = (conf >= th) & (margin >= mg)
            pass_rate = (correct & ok).sum() / max(correct.sum(), 1)
            reject_wrong = (wrong & ~ok).sum() / max(wrong.sum(), 1) if wrong.any() else 1.0
            if pass_rate >= TARGET_PASS and (reject_wrong, th + mg) > (best[2], best[0] + best[1]):
                best = (float(th), float(mg), float(reject_wrong), float(pass_rate))
    return best


def report(name, probs, y, classes):
    pred = probs.argmax(1)
    acc = float((pred == y).mean()) if len(y) else float("nan")
    print(f"\n{name}: hold-out accuracy {acc:.3f} ({(pred == y).sum()}/{len(y)})")
    per = defaultdict(lambda: [0, 0])
    conf = Counter()
    for a, b in zip(y, pred):
        per[classes[a]][1] += 1
        per[classes[a]][0] += int(a == b)
        if a != b:
            conf[(classes[a], classes[b])] += 1
    print("  per label: " + "  ".join(f"{k} {v[0]}/{v[1]}" for k, v in sorted(per.items())))
    if conf:
        print("  confusions: " + ", ".join(f"{a}->{b} x{n}" for (a, b), n in conf.most_common(8)))
    return acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout-signer")
    ap.add_argument("--epochs", type=int, default=120)
    ap.add_argument("--no-final", action="store_true")
    args = ap.parse_args()

    p0, p1, none = load_labels()
    items = load([*p0, *p1, none])
    counts = Counter(i["label"] for i in items)
    classes = [lab for lab in [*p0, *p1, none] if counts[lab] >= MIN_SAMPLES]
    items = [i for i in items if i["label"] in classes]
    print(f"{len(items)} samples, {len(classes)} classes: " + ", ".join(f"{c} {counts[c]}" for c in classes))
    if len(classes) < 2:
        raise SystemExit("need at least 2 labels with >= 3 samples each")
    none_idx = classes.index(none) if none in classes else -1

    rng = np.random.default_rng(0)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    train, test = split(items, args.holdout_signer)
    t0 = time.time()
    x_tr, y_tr = build(train, classes, rng, AUG_PER_SAMPLE)
    x_te, y_te = build(test, classes, rng, 0)
    mean, std = standardiser(x_tr)
    z_tr, z_te = (x_tr - mean) / std, (x_te - mean) / std
    print(f"features: train {z_tr.shape}, hold-out {z_te.shape} ({time.time() - t0:.1f} s), device {device}")

    orig = np.arange(len(z_tr)) % (AUG_PER_SAMPLE + 1) == 0
    templates, tlabels = z_tr.reshape(len(z_tr), -1), y_tr
    temp = knn_temp(z_tr[orig].reshape(orig.sum(), -1), y_tr[orig], len(classes))
    results = {}
    if len(test):
        results["knn"] = knn_probs(z_te.reshape(len(z_te), -1), templates, tlabels, len(classes), temp)
        t0 = time.time()
        net = train_cnn(z_tr, y_tr, len(classes), args.epochs, device)
        print(f"cnn trained in {time.time() - t0:.1f} s")
        results["cnn1d"] = cnn_probs(net, z_te)
        accs = {k: report(k, v, y_te, classes) for k, v in results.items()}
        arch = max(accs, key=lambda k: (accs[k], k == "cnn1d"))
        th, mg, rej, pas = choose_rejection(results[arch], y_te, none_idx)
        print(f"\nchosen: {arch}; rejection threshold {th:.2f}, margin {mg:.2f} "
              f"(passes {pas:.0%} of correct, rejects {rej:.0%} of wrong)")
    else:
        print("no hold-out samples: shipping cnn1d with default rejection")
        arch, th, mg, accs = "cnn1d", 0.6, 0.2, {}

    if not args.no_final and len(test):
        x_all, y_all = build(items, classes, rng, AUG_PER_SAMPLE)
        mean, std = standardiser(x_all)
        z_tr, y_tr = (x_all - mean) / std, y_all
        templates, tlabels = z_tr.reshape(len(z_tr), -1), y_tr
        orig = np.arange(len(z_tr)) % (AUG_PER_SAMPLE + 1) == 0
        temp = knn_temp(z_tr[orig].reshape(orig.sum(), -1), y_tr[orig], len(classes))
        print(f"final retrain on all {len(items)} samples")

    OUT.mkdir(parents=True, exist_ok=True)
    cfg = {"arch": arch, "labels": classes, "none": none, "seq_len": SEQ_LEN, "feat_dim": FEAT_DIM, "width": 128,
           "mean": mean.tolist(), "std": std.tolist(), "threshold": th, "margin": mg, "temp": temp,
           "holdout_acc": accs, "trained": time.strftime("%Y-%m-%d %H:%M:%S")}
    if arch == "cnn1d":
        net = train_cnn(z_tr, y_tr, len(classes), args.epochs, device) if not args.no_final or not len(test) else net
        torch.save(net.state_dict(), OUT / "model.pt")
        (OUT / "knn.npz").unlink(missing_ok=True)
    else:
        np.savez_compressed(OUT / "knn.npz", templates=templates.astype(np.float32), labels=tlabels)
        (OUT / "model.pt").unlink(missing_ok=True)
    (OUT / "config.json").write_text(json.dumps(cfg))
    print(f"wrote {OUT}/config.json + {'model.pt' if arch == 'cnn1d' else 'knn.npz'}")


if __name__ == "__main__":
    main()
