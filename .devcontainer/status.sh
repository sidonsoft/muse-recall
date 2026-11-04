#!/usr/bin/env bash
# Attach-time status for Codespaces (postAttachCommand).
#
# Prints where the app is and what to do next. It never starts, stops or
# modifies anything: reattaching cannot disturb a running session or a judge's
# work. Every probe has a short timeout so a stopped app cannot hang the attach.
set -uo pipefail

cd "$(dirname "$0")/.." 2>/dev/null || true

API="http://127.0.0.1:8787/api/live"
WEB="http://127.0.0.1:5173"

if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  APP_URL="https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  APP_URL="http://127.0.0.1:5173"
fi

api_ok=0
web_ok=0
curl -fsS --max-time 2 "$API" >/dev/null 2>&1 && api_ok=1
curl -fsS --max-time 2 "$WEB" >/dev/null 2>&1 && web_ok=1

echo
echo "Muse Recall — ${APP_URL}"
if [ "$api_ok" = "1" ] && [ "$web_ok" = "1" ]; then
  echo "  app: ready (API 8787 and web 5173 both answer on loopback)"
else
  echo "  app: NOT fully up (API: $([ "$api_ok" = "1" ] && echo up || echo down), web: $([ "$web_ok" = "1" ] && echo up || echo down))"
  echo "  start it:  bash .devcontainer/start.sh   (runs on container start; safe to re-run)"
  echo "  logs:      tail -f .devcontainer/.logs/dev.log"
fi
if [ -f .env ]; then
  echo "  provider: $(grep -E '^MODEL_PROVIDER=' .env 2>/dev/null | tail -1 || echo MODEL_PROVIDER unset)"
else
  echo "  provider: no .env yet — run bash .devcontainer/setup.sh first"
fi
echo "  walkthrough: .devcontainer/README.md (5-minute offline tour + optional live setup)"
echo "  stop:        pkill -f 'pnpm dev' (or kill the pid in .devcontainer/.logs/dev.pid)"
echo
