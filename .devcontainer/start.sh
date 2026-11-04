#!/usr/bin/env bash
# Idempotent app start for Codespaces (postStartCommand).
#
# Starts the app in the background when it is not already healthy, and does
# nothing but report when it is — so container restarts never pile a second
# server onto the same ports, and re-running this script is always safe.
# Concurrent runs are serialised with an atomic lock directory: exactly one
# instance starts, the others wait for it and report.
#
# Foreground logs live in the log directory; to watch them: tail -f there, or
# stop the background app with `bash .devcontainer/stop.sh` and run the start
# command yourself.
#
# Environment overrides (all optional; production defaults shown). The test
# harness uses them to run the real script against disposable ports and a
# stubbed start command — behaviour below is the behaviour under test.
#   CODESPACES_APP_API   http://127.0.0.1:8787/api/live
#   CODESPACES_APP_WEB   http://127.0.0.1:5173
#   CODESPACES_START_CMD pnpm dev            (run in the checkout root)
#   CODESPACES_PID_FILE  .devcontainer/.logs/dev.pid
#   CODESPACES_LOG_DIR   .devcontainer/.logs
#   CODESPACES_START_WAIT_SECS 120           (how long to wait for health)
set -uo pipefail

cd "$(dirname "$0")/.."
source .devcontainer/process-identity.sh

API="${CODESPACES_APP_API:-http://127.0.0.1:8787/api/live}"
WEB="${CODESPACES_APP_WEB:-http://127.0.0.1:5173}"
START_CMD="${CODESPACES_START_CMD:-pnpm dev}"
LOG_DIR="${CODESPACES_LOG_DIR:-.devcontainer/.logs}"
PID_FILE="${CODESPACES_PID_FILE:-$LOG_DIR/dev.pid}"
WAIT_SECS="${CODESPACES_START_WAIT_SECS:-120}"
LOCK_DIR="$LOG_DIR/start.lock"

healthy() {
  curl -fsS --max-time 2 "$API" >/dev/null 2>&1
}

web_ok() {
  curl -fsS --max-time 2 "$WEB" >/dev/null 2>&1
}

app_up() {
  healthy && web_ok
}

pid_alive() {
  case "${1:-}" in ''|*[!0-9]*|0) return 1 ;; esac
  kill -0 "$1" 2>/dev/null
}

# --- One-at-a-time start ----------------------------------------------------
# mkdir is atomic: exactly one concurrent run wins the lock. A lock held by a
# dead process is stale (a killed start) and is taken over after reporting it.
lock_holder=""
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" >"$LOCK_DIR/pid"
    lock_holder="$$"
    return 0
  fi
  local holder=""
  holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && ! pid_alive "$holder"; then
    # Serialize stale-lock recovery as well: two recoverers must never remove
    # a fresh lock that the other one just acquired. If recovery is interrupted,
    # leave its guard for inspection rather than stealing a live start's lock.
    local recovery="$LOG_DIR/start.recovery"
    if mkdir "$recovery" 2>/dev/null; then
      holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
      if [ -n "$holder" ] && ! pid_alive "$holder"; then
        echo "A previous start (pid $holder) died holding the lock; taking over."
        rm -rf "$LOCK_DIR"
        if mkdir "$LOCK_DIR" 2>/dev/null; then
          echo "$$" >"$LOCK_DIR/pid"
          lock_holder="$$"
          rmdir "$recovery"
          return 0
        fi
      fi
      rmdir "$recovery"
    fi
  fi
  return 1
}

release_lock() {
  if [ "$lock_holder" = "$$" ]; then
    rm -rf "$LOCK_DIR"
    lock_holder=""
  fi
}

if app_up; then
  echo "Muse Recall is already running (API and web both answer)."
  bash .devcontainer/status.sh
  exit 0
fi

mkdir -p "$LOG_DIR"
lock_deadline=$((SECONDS + WAIT_SECS))
while ! acquire_lock; do
  if app_up; then
    echo "Another start is in progress; the app became healthy while waiting."
    bash .devcontainer/status.sh
    exit 0
  fi
  if [ "$SECONDS" -ge "$lock_deadline" ]; then
    echo "Waited ${WAIT_SECS}s for the in-progress start, but the app is still not healthy."
    echo "Inspect $LOCK_DIR and $LOG_DIR/start.recovery before removing stale locks."
    exit 1
  fi
  # Retry if another waiter acquired a lock that briefly disappeared. A
  # one-shot retry would fail even though that winner is starting normally.
  sleep 1
done
trap release_lock EXIT

if healthy || web_ok; then
  echo "WARNING: only half of the app answers (API: $(healthy && echo up || echo down), web: $(web_ok && echo up || echo down))."
  echo "A previous start may still be coming up, or a stale process holds one port."
  echo "Check which process holds the port, stop it, then re-run this script."
  release_lock
  bash .devcontainer/status.sh
  exit 0
fi

# A pid file from a dead run must not block a fresh start — but a live one
# means someone else owns the app.
if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if pid_alive "$old_pid" && [ ! -r "$PID_FILE.identity" ]; then
    echo "A live pid $old_pid has no process identity; inspect the old record before starting another app."
    exit 1
  fi
  if pid_alive "$old_pid" && recorded_process_matches "$old_pid" "$PID_FILE.identity"; then
    echo "A previous background start (pid $old_pid) is still alive but unhealthy; leaving it alone."
    echo "Stop it ('bash .devcontainer/stop.sh'), then re-run this script."
    release_lock
    exit 0
  else
    echo "Removing the stale pid file from dead process ${old_pid:-unknown}."
    # A reused PID belongs to somebody else: discard only our stale record.
    rm -f "$PID_FILE" "$PID_FILE.identity"
  fi
fi

echo "Starting the app in the background (logs: $LOG_DIR/dev.log)…"
# setsid detaches the app into its own process group so `stop.sh` can signal
# the whole tree (server plus its children) without pattern-matching — which
# could hit unrelated development processes. Fall back to plain nohup where
# setsid is unavailable.
if command -v setsid >/dev/null 2>&1; then
  nohup setsid bash -c "$START_CMD" >"$LOG_DIR/dev.log" 2>&1 &
else
  # shellcheck disable=SC2086
  nohup bash -c "$START_CMD" >"$LOG_DIR/dev.log" 2>&1 &
fi
app_pid="$!"
process_identity "$app_pid" >"$PID_FILE.identity" || {
  echo "The app exited before its process identity could be recorded; inspect $LOG_DIR/dev.log."
  exit 1
}
echo "$app_pid" >"$PID_FILE"
disown 2>/dev/null || true

READY=0
waited=0
while [ "$waited" -lt "$WAIT_SECS" ]; do
  if app_up; then
    READY=1
    break
  fi
  sleep 2
  waited=$((waited + 2))
done

if [ "$READY" = "1" ]; then
  echo "Muse Recall is up."
  release_lock
  # status.sh resolves its script dir from its own path, so the harness can
  # point PATH-less invocations at stubbed copies; prefer the sibling script.
  bash .devcontainer/status.sh
else
  echo "The app did not become healthy within ~${WAIT_SECS}s. Last log lines:"
  tail -20 "$LOG_DIR/dev.log" 2>/dev/null || true
  echo "Fix what the log says, then re-run: bash .devcontainer/start.sh"
  exit 1
fi
