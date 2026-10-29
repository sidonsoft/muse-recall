#!/usr/bin/env bash
# Thin client for the isolated Muse Recall API used in this run.
# Every call is appended to calls.log (method, path, HTTP status, time).
set -euo pipefail
API="${MR_API:-http://127.0.0.1:8797}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$HERE/calls.log"

call() { # call METHOD PATH [JSON_BODY]
  local method="$1" path="$2" body="${3:-}" out code
  out="$(mktemp "$HERE/.resp.XXXXXX")"
  if [[ -n "$body" ]]; then
    code="$(curl -s -o "$out" -w '%{http_code}' -X "$method" -H 'content-type: application/json' --data "$body" "$API$path")"
  else
    code="$(curl -s -o "$out" -w '%{http_code}' -X "$method" "$API$path")"
  fi
  printf '%s %s %s %s\n' "$(date -u +%FT%TZ)" "$method" "$path" "$code" >>"$LOG"
  cat "$out"; echo
  rm -f "$out"
}

wait_job() { # wait_job JOB_ID [TIMEOUT_SECONDS]
  local id="$1" limit="${2:-900}" start status
  start=$(date +%s)
  while :; do
    status="$(curl -s "$API/api/forge/jobs/$id" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])')"
    case "$status" in
      queued|running) ;;
      *) printf '%s WAIT %s -> %s after %ss\n' "$(date -u +%FT%TZ)" "$id" "$status" "$(( $(date +%s) - start ))" >>"$LOG"
         echo "$status"; return 0 ;;
    esac
    if (( $(date +%s) - start > limit )); then echo "timeout(still $status)"; return 1; fi
    sleep 5
  done
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  get)      call GET "$1" ;;
  post)     call POST "$1" "${2:-}" ;;
  patch)    call PATCH "$1" "${2:-}" ;;
  wait-job) wait_job "$@" ;;
  # Save the staged or approved HTML to a file for inspection: artifact PROJECT OUTFILE [JOB_ID]
  artifact)
    q=""; [[ -n "${3:-}" ]] && q="?job=$3"
    curl -s "$API/api/forge/projects/$1/artifact$q" \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);a=d["data"];open(sys.argv[1],"w").write(a["html"]);print("saved",sys.argv[1],a["bytes"],"bytes sha256",a["sha256"],"staged" if a["staged"] else "version %s"%a["version"])' "$2"
    printf '%s GET /api/forge/projects/%s/artifact%s -> %s\n' "$(date -u +%FT%TZ)" "$1" "$q" "$2" >>"$LOG" ;;
  *) echo "usage: mr.sh get|post|patch PATH [JSON] | wait-job JOB_ID [SECS] | artifact PROJECT OUTFILE [JOB_ID]" ;;
esac
