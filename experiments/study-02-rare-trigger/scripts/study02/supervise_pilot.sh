#!/usr/bin/env bash
# Study 02 pilot supervisor (checkpoint 2).
#
# The Dell PolyStrata endpoint is a manually launched console process reachable
# over the LAN; it can be briefly unreachable (we observed one EHOSTUNREACH
# during a harness restart), and the pilot is intentionally resumable. This
# supervisor relaunches the pilot runner after any exit until all 132 records
# exist, so a transient network failure cannot silently truncate the pilot.
#
# It never runs the confirmatory experiment (the runner refuses it) and never
# exceeds the approved pilot plan: the runner itself refuses unless the plan is
# exactly 120 primary + 12 repeat executions.
#
# Usage (Lead only, endpoint exclusive):
#   scripts/study02/supervise_pilot.sh
set -u
STUDY="experiments/study-02-rare-trigger"
cd "$(dirname "$0")/../../../.." || exit 1
TARGET=132
PIDFILE="$STUDY/pilot/supervisor.pid"
mkdir -p "$STUDY/pilot"

if pgrep -f "run_pilot.mjs --resume" >/dev/null 2>&1; then
  echo "[supervisor] a pilot runner is already active; refusing to start a second one" >&2
  exit 0
fi
echo $$ > "$PIDFILE"
echo "[supervisor] pid $$ at $(date)"

while :; do
  n=$(find "$STUDY/pilot/records" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
  echo "[supervisor] $(date) recorded=$n/$TARGET"
  if [ "$n" -ge "$TARGET" ]; then
    echo "[supervisor] complete: $n records; exiting"
    break
  fi
  # Wait until the Dell single slot is idle before launching: a killed client
  # leaves the server generating, and a new request then queues behind it
  # (observed 2026-10-31: a "hung" request was actually queued for ~5 min).
  idle=0
  for _w in $(seq 1 90); do
    busy=$(curl -s --max-time 4 http://192.168.86.39:8080/slots 2>/dev/null | grep -c '"is_processing": true' || true)
    if [ "${busy:-0}" = "0" ]; then idle=1; break; fi
    sleep 10
  done
  echo "[supervisor] $(date) endpoint idle=$idle"
  pnpm exec tsx "$STUDY/scripts/study02/run_pilot.mjs" --resume 2>&1 | tee -a "$STUDY/pilot/run.log"
  rc=${PIPESTATUS[0]}
  echo "[supervisor] $(date) runner exited rc=$rc; retrying in 30 s" | tee -a "$STUDY/pilot/run.log"
  sleep 30
done
