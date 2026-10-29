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

  # The forwarded web origin is trusted at server start from the codespace's
  # own environment (apps/server/src/codespaces.ts), so nothing is written here.
fi

pnpm demo:seed

echo
echo "Muse Recall is ready. 'pnpm dev' starts it; open the forwarded port 5173."
