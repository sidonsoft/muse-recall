#!/usr/bin/env bash
# Codespaces / dev container setup for Muse Recall.
#
# Installs dependencies, writes a local `.env` for the offline provider and
# seeds the recorded demo project. Safe to re-run: an existing `.env` is kept.
set -euo pipefail

cd "$(dirname "$0")/.."

# Node 25+ no longer bundles corepack, so install the pinned pnpm directly.
PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if ! command -v pnpm >/dev/null 2>&1 || [ "$(pnpm -v)" != "$PNPM_VERSION" ]; then
  npm install -g "pnpm@${PNPM_VERSION}"
fi

pnpm install --frozen-lockfile

if [ ! -f .env ]; then
  cp .env.example .env
  # No Muse CLI or credentials in the container: use the labelled offline
  # provider, which never impersonates a model.
  sed -i 's/^MODEL_PROVIDER=.*/MODEL_PROVIDER=echo/' .env

  # Codespaces serves the web app from https://<name>-5173.<domain>. The API's
  # origin guard rejects state-changing requests from origins it does not know,
  # so trust exactly this codespace's forwarded web origin, nothing wider.
  if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
    origin="https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
    sed -i "s#^CORS_ORIGINS=.*#&,${origin}#" .env
  fi
fi

pnpm demo:seed

echo
echo "Muse Recall is ready. 'pnpm dev' starts it; open the forwarded port 5173."
