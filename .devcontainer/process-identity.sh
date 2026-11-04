#!/usr/bin/env bash
# Sourced by lifecycle scripts. PID numbers alone are reused after restarts.
process_identity() {
  local process_pid="${1:-}" fields boot
  case "$process_pid" in ''|*[!0-9]*|0) return 1 ;; esac
  if [ -r "/proc/$process_pid/stat" ] && [ -r /proc/sys/kernel/random/boot_id ]; then
    # Strip the parenthesized command before indexing: it can contain spaces.
    fields="$(sed 's/^.*) //' "/proc/$process_pid/stat")" || return 1
    boot="$(cat /proc/sys/kernel/random/boot_id)" || return 1
    set -- $fields
    [ "$#" -ge 20 ] || return 1
    printf 'linux:%s:%s\n' "$boot" "${20}"
  else
    fields="$(LC_ALL=C ps -o lstart= -p "$process_pid" 2>/dev/null)" || return 1
    [ -n "$fields" ] || return 1
    printf 'ps:%s\n' "$fields"
  fi
}

recorded_process_matches() {
  local process_pid="$1" identity_file="$2" actual expected
  [ -r "$identity_file" ] || return 1
  expected="$(cat "$identity_file")" || return 1
  actual="$(process_identity "$process_pid")" || return 1
  [ -n "$expected" ] && [ "$expected" = "$actual" ]
}
