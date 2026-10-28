#!/usr/bin/env bash
# Start `pnpm dev` inside the devcontainer.
#
# In GitHub Codespaces the browser reaches the app at
# https://<codespace>-5173.<forwarding domain>. The server and Vite accept only
# loopback hosts by default; this script opts in to exactly this codespace's two
# forwarded origins through FORWARDED_ORIGINS. Nothing else is trusted, and a
# plain local checkout never sets it.
set -euo pipefail

cd "$(dirname "$0")/.."

if (exec 3<>/dev/tcp/127.0.0.1/5173) 2>/dev/null; then
  echo "Muse Recall is already running on port 5173 (see the Ports tab)."
  exit 0
fi

if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  domain="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  export FORWARDED_ORIGINS="https://${CODESPACE_NAME}-5173.${domain},https://${CODESPACE_NAME}-8787.${domain}"
  echo "Muse Recall: https://${CODESPACE_NAME}-5173.${domain}"
fi

echo "Model provider: ${MODEL_PROVIDER:-muse-cli} (echo = offline; browse the seeded demo project)."
exec pnpm dev
