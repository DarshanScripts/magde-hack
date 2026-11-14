#!/usr/bin/env bash
# Stops and starts the whole project again (e.g. after editing .env). Same arguments as run.sh.
cd "$(dirname "$0")"
./stop.sh
sleep 2
./run.sh "$@"
