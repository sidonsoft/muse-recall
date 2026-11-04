#!/usr/bin/env bash
# Codespaces / dev container setup for Muse Recall.
#
# Installs dependencies, Playwright Chromium and its system libraries, writes a
# local `.env` for the offline provider and seeds the recorded demo project.
#
# Safe to re-run: an existing `.env` is kept, and an existing demo project is
# never reseeded (reseeding would delete generated versions). The Muse Code CLI
# is NOT installed by default — see INSTALL_MUSE_CLI below.
#
# Environment overrides:
#   SEED_DEMO=force    reseed forge-demo even when project state already exists
#                      (deletes generated versions, staging and jobs in that
#                      project only). SEED_DEMO=never skips seeding entirely.
#   INSTALL_MUSE_CLI=1 install the Muse Code CLI from the official launcher
#                      (opt-in: the launcher follows the release channel, so the
#                      installed version cannot be pinned — it is recorded below).
#   SKIP_BROWSER_INSTALL=1  skip the Playwright Chromium install.
set -euo pipefail

cd "$(dirname "$0")/.."

# Anonymous launch count (see "Launch count" in .devcontainer/README.md). Only in a
# real codespace, one plain GET that sends nothing but the counter name, gives up after
# 3 seconds and never fails setup. Opt out with DO_NOT_TRACK=1 or MUSE_RECALL_NO_COUNT=1.
if [ "${CODESPACES:-}" = "true" ] && [ -z "${DO_NOT_TRACK:-}" ] && [ -z "${MUSE_RECALL_NO_COUNT:-}" ] \
  && command -v curl >/dev/null 2>&1; then
  # The owner's own test launches go to a separate counter. The username is compared
  # here and never sent.
  COUNTER="codespaces-launches"
  [ "${GITHUB_USER:-}" = "sidonsoft" ] && COUNTER="codespaces-launches-owner"
  curl -fsS --max-time 3 -o /dev/null \
    "https://abacus.jasoncameron.dev/hit/sidonsoft-muse-recall/${COUNTER}" || true
fi

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
  # Portable rewrite: BSD sed (macOS host runs) rejects GNU-style `-i expr`;
  # a temp-file swap works on both. Observed live on macOS: the old form made
  # this script abort under `set -e` halfway through setup.
  sed 's/^MODEL_PROVIDER=.*/MODEL_PROVIDER=echo/' .env > .env.tmp && mv .env.tmp .env

  # The forwarded web origin is trusted at server start from the codespace's
  # own environment (apps/server/src/codespaces.ts), so nothing is written here.
else
  echo "Keeping the existing .env (credentials and settings are never overwritten)."
fi

# --- Verification browser -------------------------------------------------
# The approval flow loads every staged application in managed Chromium before it
# can be approved, so the container needs the Playwright build the lockfile
# pins — the same command CI uses. System libraries (--with-deps) need root:
# use passwordless sudo when available, install the browser alone otherwise and
# say so. A failed browser install never fails setup: offline exploration does
# not need it, and the exact next step is printed.
if [ "${SKIP_BROWSER_INSTALL:-}" = "1" ]; then
  echo "Skipping Playwright Chromium install (SKIP_BROWSER_INSTALL=1)."
else
  SUDO=""
  if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  fi
  if [ "$(uname -s)" = "Linux" ]; then
    # shellcheck disable=SC2086
    if ! $SUDO pnpm exec playwright-core install --with-deps chromium; then
      echo "WARNING: 'install --with-deps chromium' failed; trying the browser alone."
      pnpm exec playwright-core install chromium \
        || echo "WARNING: managed Chromium is not installed. Approval and 'pnpm verify:studio-workflow' will fail until 'pnpm exec playwright-core install --with-deps chromium' succeeds."
    fi
  else
    pnpm exec playwright-core install chromium \
      || echo "WARNING: managed Chromium is not installed (see above). Offline browsing still works."
  fi
fi

# --- Muse Code CLI (opt-in) ------------------------------------------------
# The container explores offline by default. Pass INSTALL_MUSE_CLI=1 to fetch
# the CLI from the official launcher; the install script records the version it
# installed. A login is still a separate, human step (see .devcontainer/README.md
# "Optional live setup") — installing the binary never authenticates anything.
if [ "${INSTALL_MUSE_CLI:-}" = "1" ]; then
  bash .devcontainer/install-muse-cli.sh
else
  echo "Muse Code CLI not installed (default): Studio generation stays disabled."
  echo "To enable the optional live path, re-run with INSTALL_MUSE_CLI=1 (then 'muse login')."
fi

# --- Demo seed (never overwrites) ------------------------------------------
# seedForgeDemo wipes and rewrites the forge-demo workspace (versions, staging,
# jobs), so re-running it would delete a judge's generated work. Seed only when
# the project has no state yet; SEED_DEMO=force explicitly re-runs it.
env_value() {
  # Print the value of $1 from .env, or $2 when absent. No sourcing: .env is
  # not a shell script and must never be executed.
  local key="$1" fallback="$2" line
  line="$(grep -E "^${key}=" .env 2>/dev/null | tail -1 || true)"
  if [ -z "$line" ]; then
    printf '%s\n' "$fallback"
  else
    printf '%s\n' "${line#*=}"
  fi
}

WORKSPACE_ROOT="$(env_value WORKSPACE_ROOT ./workspaces)"
DEMO_STATE="${WORKSPACE_ROOT%/}/forge/forge-demo/state.json"
if [ "${SEED_DEMO:-auto}" = "never" ]; then
  echo "Skipping the demo seed (SEED_DEMO=never)."
elif [ "${SEED_DEMO:-auto}" = "force" ]; then
  echo "Reseeding forge-demo (SEED_DEMO=force) — generated versions in that project will be replaced."
  pnpm demo:seed
elif [ -f "$DEMO_STATE" ]; then
  echo "Keeping the existing forge-demo project ($DEMO_STATE exists); not reseeding."
  echo "To reset it to the recorded version 1: stop the app, then SEED_DEMO=force bash .devcontainer/setup.sh"
else
  pnpm demo:seed
fi

echo
echo "Setup evidence:"
echo "  node $(node --version), pnpm $(pnpm -v)"
if command -v muse >/dev/null 2>&1; then
  echo "  $(muse --version)"
else
  echo "  muse: not installed (offline exploration; INSTALL_MUSE_CLI=1 to add it)"
fi
(ls -d ~/.cache/ms-playwright/chromium-* ~/Library/Caches/ms-playwright/chromium-* 2>/dev/null | head -3) || echo "  chromium: managed build not found in the Playwright cache"
echo
echo "Muse Recall setup is done. The app starts automatically (see .devcontainer/start.sh);"
echo "reattaching prints its links without restarting it (see .devcontainer/status.sh)."
