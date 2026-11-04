#!/usr/bin/env bash
# Stop the background app started by `start.sh` (`postStartCommand`).
#
# Signals the app's own process group (the start wrapper detaches it with
# setsid), which reaches the server and the children it spawned, and nothing
# else: no pattern matching, so unrelated development processes — another
# `pnpm dev`, a test server, an editor watcher — are never signalled. Stale
# pid files from dead processes are removed, and stopping an already-stopped
# app is a no-op success.
#
# Environment overrides (all optional):
#   CODESPACES_PID_FILE  .devcontainer/.logs/dev.pid
#   CODESPACES_STOP_WAIT_SECS 10   (how long to wait before SIGKILL)
set -uo pipefail

cd "$(dirname "$0")/.."
source .devcontainer/process-identity.sh

LOG_DIR="${CODESPACES_LOG_DIR:-.devcontainer/.logs}"
PID_FILE="${CODESPACES_PID_FILE:-$LOG_DIR/dev.pid}"
WAIT_SECS="${CODESPACES_STOP_WAIT_SECS:-10}"

pid_alive() {
  case "${1:-}" in ''|*[!0-9]*|0) return 1 ;; esac
  kill -0 "$1" 2>/dev/null || return 1
  # A zombie no longer runs or owns a port; its parent may reap it later.
  case "$(ps -o stat= -p "$1" 2>/dev/null)" in *Z*) return 1 ;; esac
}

if [ ! -f "$PID_FILE" ]; then
  echo "No background app is recorded ($PID_FILE is absent); nothing to stop."
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if ! pid_alive "$pid"; then
  echo "Removing the stale pid file (process ${pid:-unknown} is not running)."
  rm -f "$PID_FILE" "$PID_FILE.identity"
  exit 0
fi

if ! recorded_process_matches "$pid" "$PID_FILE.identity"; then
  echo "Refusing to signal pid $pid: its saved process identity is missing or does not match."
  echo "The record may be from a previous container or an older script. Inspect it before manual cleanup."
  exit 1
fi

echo "Stopping the background app (pid $pid and its process group)…"
# The pid recorded at start is the setsid leader, so its process group is the
# whole app tree. A negative pid signals the group; where group signalling is
# unavailable (or the start predates setsid), fall back to the recorded pid
# plus every descendant, collected before signalling so orphans cannot escape
# the snapshot. Either way nothing is matched by name: only this tree.
descendants() {
  local parent="$1" child
  for child in $(pgrep -P "$parent" 2>/dev/null || true); do
    echo "$child"
    descendants "$child"
  done
}
# Keep the snapshot after the parent exits: otherwise a child which ignores
# SIGTERM becomes an orphan and disappears from a second descendant query.
tree="$(descendants "$pid")"
group_signalled=0
if kill -- "-$pid" 2>/dev/null; then
  group_signalled=1
else
  kill "$pid" 2>/dev/null || true
  for child in $tree; do
    kill "$child" 2>/dev/null || true
  done
fi

app_alive() {
  if [ "$group_signalled" = "1" ]; then
    ps -eo pgid=,stat= | awk -v group="$pid" '$1 == group && $2 !~ /^Z/ { alive=1 } END { exit !alive }'
  else
    local member
    for member in "$pid" $tree; do
      if pid_alive "$member"; then return 0; fi
    done
    return 1
  fi
}

waited=0
while app_alive && [ "$waited" -lt "$WAIT_SECS" ]; do
  sleep 1
  waited=$((waited + 1))
done

if app_alive; then
  echo "The app tree ignored termination; sending SIGKILL to the remaining processes."
  if [ "$group_signalled" = "1" ]; then
    kill -KILL -- "-$pid" 2>/dev/null || true
  else
    kill -KILL "$pid" 2>/dev/null || true
    for child in $tree; do
      kill -KILL "$child" 2>/dev/null || true
    done
  fi
  sleep 1
fi

if app_alive; then
  echo "The app tree is still alive; leaving $PID_FILE in place for inspection."
  exit 1
fi
rm -f "$PID_FILE" "$PID_FILE.identity"
echo "Stopped."
