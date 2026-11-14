#!/usr/bin/env bash
# Stops everything run.sh started: sign service, Next.js dev server, ngrok tunnel (and the GPU Chrome profile on Linux).
cd "$(dirname "$0")"

case "$OSTYPE" in
msys* | cygwin*)
  # Kill this repo's sign service (not this PowerShell, whose own command line matches too) and dev server by command line, and ngrok, with their child processes.
  powershell.exe -NoProfile -Command "
    \$repo = '$(cygpath -w "$PWD")'.ToLower()
    function Stop-Matching(\$name, \$test) {
      \$found = @(Get-CimInstance Win32_Process | Where-Object { \$_.ProcessId -ne \$PID -and \$_.Name -notmatch '^(powershell|pwsh|bash)\.exe\$' -and \$_.CommandLine -and (& \$test \$_.CommandLine.ToLower()) })
      foreach (\$p in \$found) { taskkill /PID \$p.ProcessId /T /F *> \$null }
      if (\$found.Count) { \"\$name stopped\" } else { \"\$name was not running\" }
    }
    Stop-Matching 'sign service' { param(\$c) \$c.Contains(\$repo + '\sign\.venv') -and \$c.Contains('server:app') }
    Stop-Matching 'web' { param(\$c) \$c.Contains(\$repo + '\web\node_modules\next') -or \$c.Contains('--prefix web run dev') }
    Stop-Matching 'ngrok' { param(\$c) \$c -match 'ngrok(\.exe)?\"?\s+http\s+3000' }
    # Anything still holding the ports (e.g. started by hand with a relative path).
    foreach (\$c in @(Get-NetTCPConnection -State Listen -LocalPort 8765,3000,4040 -ErrorAction SilentlyContinue)) {
      taskkill /PID \$c.OwningProcess /T /F *> \$null; \"stopped what was left on port \$(\$c.LocalPort)\"
    }
  "
  ;;
*)
  pkill -f "[u]vicorn server:app" && echo "sign service stopped" || echo "sign service was not running"
  pkill -f "[n]ext dev" && echo "web stopped" || echo "web was not running"
  pkill -f "[n]grok http 3000" && echo "ngrok stopped" || echo "ngrok was not running"
  pkill -f "[u]ser-data-dir=/tmp/chrome-nvidia" && echo "GPU Chrome stopped" || echo "GPU Chrome was not running"
  ;;
esac
