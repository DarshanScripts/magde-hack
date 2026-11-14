#!/usr/bin/env bash
# Starts the sign service, the Next.js dev server and a browser.
# Usage: ./run.sh [page]   e.g. ./run.sh /  (main page), default /record
# SIGN_FAKE=HALLO,TERMIN,WOLLEN ./run.sh /  → without a trained model, each detected sign emits the next gloss.
# Safe to run again: whatever is already listening is skipped (restart with ./stop.sh to change SIGN_FAKE).
# Logs: /tmp/mghack-sign.log, /tmp/mghack-web.log
cd "$(dirname "$0")"

wait_for() { # url, name, tries
  for _ in $(seq 1 "$3"); do
    curl -sf "$1" >/dev/null && return 0
    sleep 1
  done
  echo "ERROR: $2 did not come up at $1 — check the log above" >&2
  return 1
}

if curl -sf http://localhost:8765/health >/dev/null; then
  echo "sign service already running (8765)"
else
  SIGN_DUMP=/tmp/sign_stream.jsonl nohup sign/.venv/bin/uvicorn server:app \
    --app-dir sign --port 8765 >/tmp/mghack-sign.log 2>&1 &
  wait_for http://localhost:8765/health "sign service" 45 && echo "sign service up (8765)"
fi

if curl -sf http://localhost:3000/record >/dev/null; then
  echo "web already running (3000)"
else
  nohup npm --prefix web run dev >/tmp/mghack-web.log 2>&1 &
  wait_for http://localhost:3000/record "web" 60 && echo "web up (3000)"
fi

URL="http://localhost:3000${1:-/record}"
if command -v prime-run >/dev/null && command -v google-chrome-stable >/dev/null; then
  # GTX 1050 laptop: Chrome on the NVIDIA GPU (needs X11 mode, separate profile)
  prime-run google-chrome-stable --ozone-platform=x11 --user-data-dir=/tmp/chrome-nvidia "$URL" >/dev/null 2>&1 &
else
  xdg-open "$URL" >/dev/null 2>&1 || open "$URL" 2>/dev/null || echo "open $URL in Chrome"
fi
echo "browser -> $URL"
