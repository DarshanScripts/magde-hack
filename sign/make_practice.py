"""Builds practice/index.html: per sign the SignDict reference video, key frames and context.

Usage: cd sign && .venv/bin/python make_practice.py
Media goes to practice/media/ (gitignored; SignDict licenses, mostly CC BY-NC-SA).
"""
import html
import json
import subprocess
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "practice"
MEDIA = OUT / "media"
REFS = json.loads((ROOT / "web/lib/signRefs.json").read_text())
LABELS = json.loads((ROOT / "web/lib/labels.json").read_text())
N_FRAMES = 6

INFO = {
    "HALLO": ("hello", "HALLO NAME … → „Hallo, mein Name ist …“"),
    "DANKE": ("thanks", "DANKE → „Vielen Dank.“"),
    "TSCHUESS": ("bye", "DANKE TSCHUESS → „Vielen Dank, auf Wiederhören.“"),
    "JA": ("yes", "JA → „Ja, das passt.“"),
    "NEIN": ("no", "NEIN (head shake) → „Nein, leider nicht.“"),
    "WIEDERHOLEN": ("repeat (please say again)", "WIEDERHOLEN → „Könnten Sie das bitte wiederholen?“"),
    "NAME": ("name", "HALLO NAME … → „Hallo, mein Name ist …“"),
    "TERMIN": ("appointment", "TERMIN WOLLEN → „Ich möchte gern einen Termin vereinbaren.“"),
    "WOLLEN": ("want", "TERMIN WOLLEN → „Ich möchte gern einen Termin vereinbaren.“"),
    "HEUTE": ("today", "HEUTE NACHMITTAG (brows up) → „Geht es heute Nachmittag?“"),
    "MORGEN": ("tomorrow (not 'morning')", "MORGEN UHR … → „Morgen um … Uhr?“"),
    "NACHMITTAG": ("afternoon", "MORGEN NACHMITTAG → „Morgen Nachmittag.“"),
    "UHR": ("o'clock / time of day", "MORGEN UHR … → „Morgen um … Uhr?“"),
    "UNTERSUCHUNG": ("examination / check-up", "UNTERSUCHUNG WOLLEN → „Ich hätte gern eine Untersuchung.“"),
    "SCHMERZ": ("pain", "SCHMERZ UNTERSUCHUNG → „Ich habe Schmerzen und möchte untersucht werden.“"),
    "VORMITTAG": ("morning (before noon)", "MORGEN VORMITTAG → „Morgen Vormittag.“"),
    "ABEND": ("evening", "HEUTE ABEND → „Heute Abend.“"),
    "ZEIT": ("time", "ZEIT? → „Haben Sie Zeit?“"),
    "KOPF": ("head", "KOPF SCHMERZ → „Ich habe Kopfschmerzen.“"),
    "BAUCH": ("belly", "BAUCH SCHMERZ → „Ich habe Bauchschmerzen.“"),
    "FIEBER": ("fever", "FIEBER → „Ich habe Fieber.“"),
    "OKAY": ("okay", "OKAY → „Okay, passt.“"),
    "NICHT": ("not", "OKAY NICHT → „Das passt mir nicht.“"),
    "MOECHTEN": ("would like (video: mögen)", "TERMIN MOECHTEN → „Ich möchte einen Termin.“"),
}
EXTRA = ["KOPF", "BAUCH", "FIEBER", "VORMITTAG", "ABEND", "ZEIT", "OKAY", "NICHT", "MOECHTEN",
         "EINS", "ZWEI", "DREI", "VIER", "FUENF", "SECHS", "SIEBEN"]
NUMBERS = {
    "EINS": "Thumb out (fist), palm towards you. Hold at the chest with a short downward tap, not a thumbs-up gesture.",
    "ZWEI": "Thumb + index finger out, palm towards you.",
    "DREI": "Thumb + index + middle finger out.",
    "VIER": "Four fingers out, thumb folded in.",
    "FUENF": "Open hand, all five fingers spread.",
    "SECHS": "Open dominant hand (5) + thumb of the other hand.",
    "SIEBEN": "Open dominant hand (5) + thumb and index of the other hand.",
}


def download(label: str) -> Path:
    path = MEDIA / f"{label}.mp4"
    if not path.exists():
        req = urllib.request.Request(REFS[label]["video"], headers={"User-Agent": "Mozilla/5.0"})
        path.write_bytes(urllib.request.urlopen(req, timeout=30).read())
    return path


def key_frames(video: Path, label: str) -> list[str]:
    fps = eval(subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
         "-of", "csv=p=0", str(video)], text=True).strip())
    raw = subprocess.check_output(
        ["ffmpeg", "-v", "error", "-i", str(video), "-vf", "scale=64:48,format=gray", "-f", "rawvideo", "-"])
    frames = np.frombuffer(raw, np.uint8).reshape(-1, 48, 64).astype(np.float32)
    motion = np.convolve(np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2)), np.ones(3) / 3, "same")
    active = np.flatnonzero(motion > 0.25 * motion.max())
    lo, hi = (active[0], active[-1] + 1) if len(active) else (0, len(frames) - 1)
    names = []
    for i, idx in enumerate(np.linspace(lo, hi, N_FRAMES).round().astype(int)):
        name = f"{label}_{i}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{idx / fps:.3f}", "-i", str(video),
                        "-frames:v", "1", "-vf", "scale=240:-1", "-q:v", "3", str(MEDIA / name)], check=True)
        names.append(name)
    return names


# extended fingers (thumb, index, middle, ring, little) per hand: dominant, other
FINGERS = {
    "EINS": ("10000", None), "ZWEI": ("11000", None), "DREI": ("11100", None), "VIER": ("01111", None),
    "FUENF": ("11111", None), "SECHS": ("11111", "10000"), "SIEBEN": ("11111", "11000"),
}


def hand_svg(ext: str, title: str) -> str:
    """Schematic right hand, palm towards you (seen by you): thumb on the left. Green = extended."""
    parts = ['<rect x="30" y="80" width="80" height="70" rx="16" fill="#e7d3bf" stroke="#555"/>']
    for i, x in enumerate((38, 58, 78, 98)):
        up = ext[i + 1] == "1"
        h = 62 if up else 18
        parts.append(f'<rect x="{x - 8}" y="{82 - h}" width="16" height="{h + 8}" rx="8" '
                     f'fill="{"#22c55e" if up else "#c9b6a3"}" stroke="#555"/>')
    up = ext[0] == "1"
    parts.append(f'<rect x="{-2 if up else 18}" y="100" width="{40 if up else 22}" height="16" rx="8" '
                 f'fill="{"#22c55e" if up else "#c9b6a3"}" stroke="#555" transform="rotate(-35 30 108)"/>')
    return (f'<figure><svg viewBox="-10 0 130 160" width="150">{"".join(parts)}</svg>'
            f'<figcaption>{title}</figcaption></figure>')


def number_card(label: str) -> str:
    dom, other = FINGERS[label]
    hands = hand_svg(dom, "dominant hand")
    if other:
        hands = hand_svg(other, "other hand") + hands
    return f"""
<section class="card" id="{label}">
  <h2>{label} <span class="en">number (diagram, no reference video)</span></h2>
  <p class="ex">{html.escape(NUMBERS[label])} Example: MORGEN {label} UHR → „Morgen um {list(FINGERS).index(label) + 1} Uhr.“</p>
  <div class="row nums">{hands}</div>
  <p class="credit">Schematic, palm facing you as you see your own hand; green = extended finger.</p>
</section>"""


def card(label: str) -> str:
    if label in NUMBERS:
        return number_card(label)
    ref = REFS[label]
    meaning, example = INFO[label]
    frames = key_frames(download(label), label)
    imgs = "".join(f'<figure><img src="media/{f}"><figcaption>{i + 1}</figcaption></figure>'
                   for i, f in enumerate(frames))
    search = f"https://signdict.org/search?q={urllib.request.quote(ref['word'].split(' (')[0])}"
    return f"""
<section class="card" id="{label}">
  <h2>{label} <span class="de">{html.escape(ref['word'])}</span> <span class="en">{html.escape(meaning)}</span></h2>
  <p class="ex">In the demo: {html.escape(example)}</p>
  <div class="row">
    <div class="vid"><video src="media/{label}.mp4" autoplay loop muted playsinline></video>
      <div class="ctl"><button data-r="1">1×</button><button data-r="0.5">0.5×</button>
      <button data-r="0.25">0.25×</button><button class="mir">mirror</button></div></div>
    <div class="frames">{imgs}</div>
  </div>
  <p class="credit">Video: {html.escape(ref['credit'])}, {html.escape(ref['license'])}, via
  <a href="{search}">SignDict</a>. Key frames are taken from the moving part of the clip.</p>
</section>"""


GUIDE = """
<section class="guide">
<h2>How to use this sheet</h2>
<ol>
<li><b>Mirror on, 0.5×.</b> Watch each sign a few times, then copy it as if looking in a mirror.
The reference signer faces you; with <i>mirror</i> on, your right hand matches the screen's right hand.</li>
<li><b>One variant only.</b> Always sign exactly the variant in the video, same hand(s), same place, same
movement and mouthing. The model learns <i>your</i> version; switching variants later breaks it.</li>
<li><b>Mouth the German word</b> while signing (silently, like the reference). The model uses mouth shape.</li>
<li><b>Check the rhythm on /record in infer mode:</b> each sign should turn the badge red ("signing") once and
back to "rest" once. If one sign flips it twice, or not at all, tell the agent.</li>
</ol>

<h2>Recording session 2 (now): fast takes + new words</h2>
<p>On <code>/record</code>: <b>record</b> mode, signer <b>adi</b>. Auto-advance runs through everything in this order:</p>
<table border="1" cellpadding="4" style="border-collapse:collapse">
<tr><th>Group</th><th>Target</th><th>What</th></tr>
<tr><td>15 core signs</td><td>35 (15 old + 20 new)</td><td>New takes <b>fast</b>: about 65% of your normal length</td></tr>
<tr><td>16 new words (below)</td><td>25</td><td>Mix normal and fast</td></tr>
<tr><td>_NONE</td><td>40 (34 done)</td><td>Everyday non-sign movements</td></tr>
</table>
<ul>
<li>Loop: hands down → sign once → hands down briefly → next. One beep = one saved sample.</li>
<li>The counter box shows <b>"last take X s · normal ≈ Y s, fast ≈ Z s"</b>. Aim for the fast number.</li>
<li><b>Too fast</b> = the hand overlay flickers or vanishes (motion blur). Then <b>undo last</b> and redo slightly slower.
Good light from the front reduces blur.</li>
<li>Make every sign complete (full handshape and movement), just quicker. Same variant as before.</li>
<li>Vary a little: sitting, leaning, a few takes standing. A few with brows up/down, head shake on NEIN/NICHT.</li>
<li>EINS looks like a thumbs-up (which is in _NONE): hold it clearly at the chest.</li>
<li>Stop with ~25 min left and tell the agent "stop": training takes ~5 min, then live test.</li>
</ul>
<h2>Live (infer mode)</h2>
<p>Signs can now follow each other <b>without lowering the hands</b>: a short slow-down between signs is enough.
Lowering the hands still works and is the most reliable.</p>
</section>"""

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DGS practice sheet</title>
<style>
body{{font:15px/1.45 system-ui,sans-serif;max-width:1150px;margin:24px auto;padding:0 16px;color:#111}}
h1{{margin-bottom:4px}} nav a{{margin-right:10px;font-family:monospace}}
.card,.guide{{border:1px solid #ddd;border-radius:12px;padding:12px 16px;margin:16px 0;break-inside:avoid}}
.card h2{{margin:0 0 4px}} .de{{color:#2563eb;font-weight:500}} .en{{color:#666;font-weight:400;font-size:.8em}}
.ex{{margin:0 0 8px;color:#333}} .row{{display:flex;gap:12px;align-items:flex-start}}
.vid video{{width:320px;border-radius:8px;background:#000}} .vid.m video{{transform:scaleX(-1)}}
.frames{{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;flex:1}}
.frames img{{width:100%;border-radius:6px}} .vid.m~.frames img{{transform:scaleX(-1)}}
figure{{margin:0;position:relative}} figcaption{{position:absolute;top:4px;left:6px;background:#000a;color:#fff;
padding:0 6px;border-radius:4px;font-size:12px}}
.ctl button{{margin:4px 4px 0 0}} .ctl .on{{background:#2563eb;color:#fff}}
\n.nums figure{{background:#f7f7f7;border-radius:8px;padding:6px}} .nums figcaption{{position:static;background:none;color:#333}}\n.credit{{font-size:12px;color:#777;margin:6px 0 0}} code{{background:#f3f3f3;padding:0 4px;border-radius:4px}}
</style></head><body>
<h1>DGS practice sheet</h1>
<p>15 core signs (p0) and 16 new words. Videos loop; use 0.5× and mirror to learn.</p>
<nav>{nav}</nav>
{guide}
<h2>Core signs (record these)</h2>
{core}
<h2>New words (record these too)</h2>
{extra}
<script>
document.querySelectorAll('.vid').forEach(v=>{{const video=v.querySelector('video');
v.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{{video.playbackRate=+b.dataset.r;
v.querySelectorAll('[data-r]').forEach(x=>x.classList.toggle('on',x===b))}});
const m=v.querySelector('.mir');m.onclick=()=>{{v.classList.toggle('m');m.classList.toggle('on')}};
v.classList.add('m');m.classList.add('on')}});
</script></body></html>"""


def main():
    MEDIA.mkdir(parents=True, exist_ok=True)
    core = [label for label in LABELS["p0"] if label in REFS]
    extra = [label for label in EXTRA if label in REFS or label in NUMBERS]
    nav = " ".join(f'<a href="#{label}">{label}</a>' for label in core + extra)
    page = PAGE.format(nav=nav, guide=GUIDE, core="".join(card(label) for label in core),
                       extra="".join(card(label) for label in extra))
    (OUT / "index.html").write_text(page)
    print(f"wrote {OUT / 'index.html'} ({len(core)} core, {len(extra)} extra)")


if __name__ == "__main__":
    main()
