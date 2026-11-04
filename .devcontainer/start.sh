#!/usr/bin/env bash
# Idempotent app start for Codespaces (postStartCommand).
#
# Starts `pnpm dev` in the background when the app is not already healthy, and
# does nothing but report when it is — so container restarts never pile a
# second server onto the same ports, and re-running this script is always safe.
# Foreground logs live in .devcontainer/.logs/; to watch them: tail -f there,
# or stop the background app and run `pnpm dev` yourself.
set -uo pipefail

cd "$(dirname "$0")/.."

API="http://127.0.0.1:8787/api/live"
WEB="http://127.0.0.1:5173"
LOG_DIR=".devcontainer/.logs"
PID_FILE=".devcontainer/.logs/dev.pid"

healthy() {
  curl -fsS --max-time 2 "$API" >/dev/null 2>&1
}

web_ok() {
  curl -fsS --max-time 2 "$WEB" >/dev/null 2>&1
}

if healthy && web_ok; then
  echo "Muse Recall is already running (API and web both answer)."
  bash .devcontainer/status.sh
  exit 0
fi

if healthy || web_ok; then
  echo "WARNING: only half of the app answers (API: $(healthy && echo up || echo down), web: $(web_ok && echo up || echo down))."
  echo "A previous start may still be coming up, or a stale process holds one port."
  echo "Check: lsof -ti:8787 / lsof -ti:5173 — stop the holder, then re-run this script."
  bash .devcontainer/status.sh
  exit 0
fi

mkdir -p "$LOG_DIR"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "A previous background start (pid $(cat "$PID_FILE")) is still alive but unhealthy; leaving it alone."
  echo "Stop it ('kill $(cat "$PID_FILE")'), then re-run this script."
  exit 0
fi

echo "Starting Muse Recall in the background (logs: $LOG_DIR/dev.log)…"
# nohup + disown so the servers survive this command exiting; the app itself
# binds loopback only and the Codespaces origin handling is unchanged.
nohup pnpm dev >"$LOG_DIR/dev.log" 2>&1 &
echo "$!" >"$PID_FILE"
disown 2>/dev/null || true

READY=0
for _ in $(seq 1 60); do
  if healthy && web_ok; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" = "1" ]; then
  echo "Muse Recall is up."
  bash .devcontainer/status.sh
else
  echo "The app did not become healthy within ~2 minutes. Last log lines:"
  tail -20 "$LOG_DIR/dev.log" 2>/dev/null || true
  echo "Fix what the log says, then re-run: bash .devcontainer/start.sh"
  exit 1
fi
