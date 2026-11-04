#!/usr/bin/env bash
# Install the Meta Muse Code CLI from the official launcher (opt-in).
#
# The launcher is the only supported distribution: it is the same script the
# CLI uses to update itself, it detects Linux (x86_64, aarch64) and macOS, and
# there is no version-pinned artifact to download instead — install follows the
# release channel and this script records the version it installed. Nothing
# here authenticates: 'muse login' stays a separate human step, and no paid
# call is made during install.
#
# Official source: https://api.meta.ai/muse-launcher.sh
# (the self-update URL baked into every installed launcher).
set -euo pipefail

LAUNCHER_URL="https://api.meta.ai/muse-launcher.sh"
DEST="${MUSE_INSTALL_PATH:-$HOME/.local/bin/muse}"

if command -v muse >/dev/null 2>&1; then
  echo "muse is already on PATH: $(muse --version)"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required to fetch the Muse launcher and is not installed." >&2
  exit 1
fi

case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:aarch64|Linux:arm64|Darwin:arm64|Darwin:x86_64) ;;
  *)
    echo "ERROR: '$(uname -s) $(uname -m)' is not a platform the Muse launcher supports (Linux x86_64/aarch64, macOS arm64/x86_64)." >&2
    echo "Stay on the offline path: MODEL_PROVIDER=echo (generation buttons stay disabled, everything else works)." >&2
    exit 1
    ;;
esac

mkdir -p "$(dirname "$DEST")"
TMP="$(mktemp "${TMPDIR:-/tmp}/muse-launcher.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
curl -fsS --proto '=https' --tlsv1.2 --max-time 60 -o "$TMP" "$LAUNCHER_URL"
# The launcher applies this same check to its own updates: a body that cannot
# parse never reaches the install path.
bash -n "$TMP"
cp -f -- "$TMP" "$DEST"
chmod -- 0755 "$DEST"

# Fetch the platform binary without starting a session. MUSE_NO_AUTO_UPDATE is
# left alone so later runs keep the launcher's normal channel updates.
MUSE_LAUNCHER_INSTALL=1 "$DEST" >/dev/null
INSTALLED="$("$DEST" --version)"
echo "Installed muse to $DEST"
echo "Installed version: $INSTALLED (channel tip — the launcher carries no pinned build; recorded here as evidence)"
echo "Next: 'muse login' (device code in this terminal, approve in your browser), then restart the app with MODEL_PROVIDER=muse-cli."
case ":$PATH:" in
  *":$(dirname "$DEST"):"*) ;;
  *) echo "NOTE: $(dirname "$DEST") is not on PATH in this shell; add it or set MUSE_BIN=$DEST / FORGE_MUSE_BIN=$DEST." ;;
esac
