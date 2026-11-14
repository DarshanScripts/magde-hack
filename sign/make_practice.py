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


def card(label: str) -> str:
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

<h2>Step 3: tuning session (~2 min, before recording)</h2>
<p>Tell the agent "start tuning". It clears the stream log; then on <code>/record</code> in <b>infer</b> mode do, in order:</p>
<ol>
<li>5 different signs, slowly, hands back to rest (lap/table) and 1 s pause between them.</li>
<li>5 signs quickly in a row, only a short pause with hands still in the air (no lowering).</li>
<li>Rest hands for 10 s. Look natural, blink, small movements are fine.</li>
<li>Non-signs: scratch your head, touch glasses/face, reach for the mouse, wave casually.</li>
<li>Brows: raise eyebrows 3× (hold 1 s), furrow/lower eyebrows 3×, neutral face 3 s.</li>
<li>Head: shake your head "no" 3×, turn your head once to the side and back.</li>
</ol>
<p>Then tell the agent "tuning done". The agent replays the log and adjusts the sign-start/end,
brow and head-shake thresholds before you record.</p>

<h2>Step 4: recording the dataset (~40 min)</h2>
<h3>Setup (keep it identical to the demo)</h3>
<ul>
<li>Same seat, same laptop position, same camera. Light from the front or side, no window behind you.</li>
<li>Frame: head to belly, both elbows and some space above your head visible. Only you in the frame.</li>
<li>Rest position: hands in your lap or flat on the table, <b>below the chest</b>. That is what "rest" means to the detector.</li>
<li>Run <code>./run.sh</code>, open <code>/record</code>, switch to <b>record</b>, signer <b>adi</b>.</li>
</ul>
<h3>Per sign (15 signs × 15 samples)</h3>
<ol>
<li>Pick the label in the dropdown; the reference video plays next to the camera.</li>
<li>Loop: <b>rest → sign once → back to rest → ~1 s pause</b>. Each sign = one beep and the counter +1.</li>
<li>No beep, or two beeps for one sign → <b>undo last</b> (repeat if needed) and sign it again.
If it keeps happening for one sign, tell the agent which one.</li>
<li>Vary naturally: slightly faster/slower, a bit higher/lower, a tiny turn of the body. Don't be robotic,
don't change the variant.</li>
<li><b>Non-manuals:</b> on 3 of the 15 samples raise your eyebrows (question), on 2 lower them (W-question).
For NEIN shake your head on most samples (that's natural DGS). Keep the rest neutral.</li>
<li>Counter at 15 → <b>next label</b>. Take a short break every 5 signs.</li>
</ol>
<h3>_NONE (30 samples): movements that are not signs</h3>
<p>Label <code>_NONE</code>. Things you will do during a real call: scratch head/nose/neck, push up glasses,
touch hair, reach for mouse/keyboard, pick up a cup, stretch, wave casually, start a sign and abort it,
fidget with fingers in front of the chest. Each should beep once; that saves it.</p>
<h3>When done</h3>
<p>Tell the agent "recording done". The agent trains on the GTX 1050 (a few minutes), sends the accuracy report
and the list of confused signs; you may re-record 1–2 of them, then do the live check in infer mode.</p>
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
.credit{{font-size:12px;color:#777;margin:6px 0 0}} code{{background:#f3f3f3;padding:0 4px;border-radius:4px}}
</style></head><body>
<h1>DGS practice sheet</h1>
<p>15 core signs (p0) for the appointment call, then optional extras. Videos loop; use 0.5× and mirror to learn.</p>
<nav>{nav}</nav>
{guide}
<h2>Core signs (record these)</h2>
{core}
<h2>Optional extras (only if time allows)</h2>
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
    extra = [label for label in REFS if label not in core]
    nav = " ".join(f'<a href="#{label}">{label}</a>' for label in core + extra)
    page = PAGE.format(nav=nav, guide=GUIDE, core="".join(card(label) for label in core),
                       extra="".join(card(label) for label in extra))
    (OUT / "index.html").write_text(page)
    print(f"wrote {OUT / 'index.html'} ({len(core)} core, {len(extra)} extra)")


if __name__ == "__main__":
    main()
