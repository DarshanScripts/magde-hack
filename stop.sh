#!/usr/bin/env bash
# Stops the sign service, the Next.js dev server and the GPU Chrome profile.
pkill -f "[u]vicorn server:app" && echo "sign service stopped" || echo "sign service was not running"
pkill -f "[n]ext dev" && echo "web stopped" || echo "web was not running"
pkill -f "[u]ser-data-dir=/tmp/chrome-nvidia" && echo "GPU Chrome stopped" || echo "GPU Chrome was not running"
