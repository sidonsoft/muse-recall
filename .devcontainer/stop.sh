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

LOG_DIR="${CODESPACES_LOG_DIR:-.devcontainer/.logs}"
PID_FILE="${CODESPACES_PID_FILE:-$LOG_DIR/dev.pid}"
WAIT_SECS="${CODESPACES_STOP_WAIT_SECS:-10}"

pid_alive() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

if [ ! -f "$PID_FILE" ]; then
  echo "No background app is recorded ($PID_FILE is absent); nothing to stop."
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if ! pid_alive "$pid"; then
  echo "Removing the stale pid file (process ${pid:-unknown} is not running)."
  rm -f "$PID_FILE"
  exit 0
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
group_signalled=0
if kill -- "-$pid" 2>/dev/null; then
  group_signalled=1
else
  tree="$(descendants "$pid")"
  kill "$pid" 2>/dev/null || true
  for child in $tree; do
    kill "$child" 2>/dev/null || true
  done
fi

waited=0
while pid_alive "$pid" && [ "$waited" -lt "$WAIT_SECS" ]; do
  sleep 1
  waited=$((waited + 1))
done

if pid_alive "$pid"; then
  echo "Process $pid ignored termination; sending SIGKILL to the group."
  if [ "$group_signalled" = "1" ]; then
    kill -KILL -- "-$pid" 2>/dev/null || true
  else
    tree="$(descendants "$pid")"
    kill -KILL "$pid" 2>/dev/null || true
    for child in $tree; do
      kill -KILL "$child" 2>/dev/null || true
    done
  fi
  sleep 1
fi

if pid_alive "$pid"; then
  echo "Process $pid is still alive; leaving $PID_FILE in place for inspection."
  exit 1
fi
rm -f "$PID_FILE"
echo "Stopped."
