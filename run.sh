#!/usr/bin/env bash
# Starts the whole project: sign service (8765), Next.js dev server (3000), ngrok tunnel for the phone, and a browser.
# Works on Linux and on Windows (Git Bash). Safe to run again: whatever is already running is skipped.
# Usage: ./run.sh [page]        e.g. ./run.sh /record   (default: / , the signer page)
#   SIGN_FAKE=HALLO,TERMIN,WOLLEN ./run.sh   → no model: each detected sign emits the next gloss
#   NO_NGROK=1 ./run.sh                      → skip the phone tunnel
#   NGROK_DOMAIN=<your-static-domain> in web/.env → the same phone URL every time
# Restart everything (e.g. after editing .env or changing SIGN_FAKE): ./restart.sh
cd "$(dirname "$0")"
ROOT=$PWD

case "$OSTYPE" in msys* | cygwin*) WIN=1 ;; *) WIN= ;; esac
if [ -n "$WIN" ]; then LOGS="$ROOT/.run"; mkdir -p "$LOGS"; else LOGS=/tmp; fi
SIGN_LOG="$LOGS/mghack-sign.log" WEB_LOG="$LOGS/mghack-web.log" NGROK_LOG="$LOGS/mghack-ngrok.log"

env_value() { # key → value from web/.env (falls back to ./.env)
  for f in web/.env .env; do
    [ -f "$f" ] || continue
    v=$(grep -E "^[[:space:]]*$1=" "$f" | tail -n1 | cut -d= -f2- | tr -d '\r"'"'")
    [ -n "$v" ] && { echo "$v"; return; }
  done
}

wait_for() { # url, name, tries
  for _ in $(seq 1 "$3"); do
    curl -sf "$1" >/dev/null && return 0
    sleep 1
  done
  echo "ERROR: $2 did not come up at $1 — see $4" >&2
  return 1
}

spawn() { # log, command... (detached, survives closing this terminal)
  local log=$1; shift
  if [ -n "$WIN" ]; then
    local cmd="$*" wlog
    wlog=$(cygpath -w "$log")
    powershell.exe -NoProfile -Command "Start-Process cmd -WindowStyle Hidden -WorkingDirectory '$(cygpath -w "$ROOT")' -ArgumentList '/c', '$cmd > \"$wlog\" 2>&1'"
  else
    nohup "$@" >"$log" 2>&1 &
  fi
}

# --- sign service ---
if curl -sf http://localhost:8765/health >/dev/null; then
  echo "sign service already running (8765)"
else
  if [ -n "$WIN" ]; then
    export SIGN_DUMP; SIGN_DUMP=$(cygpath -w "$LOGS/sign_stream.jsonl")
    spawn "$SIGN_LOG" 'sign\.venv\Scripts\uvicorn.exe server:app --app-dir sign --port 8765'
  else
    SIGN_DUMP=/tmp/sign_stream.jsonl spawn "$SIGN_LOG" sign/.venv/bin/uvicorn server:app --app-dir sign --port 8765
  fi
  wait_for http://localhost:8765/health "sign service" 60 "$SIGN_LOG" && echo "sign service up (8765)${SIGN_FAKE:+, fake: $SIGN_FAKE}"
fi

# --- web ---
if curl -sf http://localhost:3000/record >/dev/null; then
  echo "web already running (3000)"
else
  spawn "$WEB_LOG" npm --prefix web run dev
  wait_for http://localhost:3000/record "web" 90 "$WEB_LOG" && echo "web up (3000)"
fi

# --- ngrok (phone needs HTTPS for the microphone) ---
tunnel_url() { curl -s http://127.0.0.1:4040/api/tunnels | grep -o '"public_url":"https://[^"]*"' | head -n1 | cut -d'"' -f4; }
PHONE=
if [ -z "$NO_NGROK" ]; then
  if ! command -v ngrok >/dev/null; then
    echo "ngrok not installed: the phone page only works on this computer"
  else
    PHONE=$(tunnel_url)
    if [ -n "$PHONE" ]; then
      echo "ngrok already running"
    else
      token=$(env_value NGROK_AUTH_TOKEN)
      [ -n "$token" ] && export NGROK_AUTHTOKEN=$token
      domain=$(env_value NGROK_DOMAIN)
      spawn "$NGROK_LOG" ngrok http 3000 --log stdout ${domain:+--url $domain}
      for _ in $(seq 1 20); do PHONE=$(tunnel_url); [ -n "$PHONE" ] && break; sleep 1; done
      [ -n "$PHONE" ] && echo "ngrok up" || echo "ERROR: ngrok did not start — see $NGROK_LOG" >&2
    fi
  fi
fi

# --- browser ---
URL="http://localhost:3000${1:-/}"
if [ -n "$WIN" ]; then
  cmd.exe //c start "" "$URL"
elif command -v prime-run >/dev/null && command -v google-chrome-stable >/dev/null; then
  # GTX 1050 laptop: Chrome on the NVIDIA GPU (needs X11 mode, separate profile)
  prime-run google-chrome-stable --ozone-platform=x11 --user-data-dir=/tmp/chrome-nvidia "$URL" >/dev/null 2>&1 &
else
  xdg-open "$URL" >/dev/null 2>&1 || open "$URL" 2>/dev/null || echo "open $URL in Chrome"
fi

echo
echo "PC (signer):    $URL"
[ -n "$PHONE" ] && echo "Phone (practice): $PHONE/callee"
echo "Logs:           $SIGN_LOG, $WEB_LOG${PHONE:+, $NGROK_LOG}"
echo "Stop: ./stop.sh   Restart: ./restart.sh"
