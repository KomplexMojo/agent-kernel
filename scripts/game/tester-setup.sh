#!/usr/bin/env bash
# One-step setup for outside playtesters (macOS or Linux): checks git and Node, gets pnpm,
# clones or updates the game, installs its packages, then runs the playtest scenarios in a loop.
# See TESTING.md. Usage: bash tester-setup.sh [scenario] [--seed N]
#   DEEPWARD_DIR=<folder>  where the game is cloned (default ~/deepward)
set -euo pipefail

REPO_URL="${DEEPWARD_REPO:-https://github.com/KomplexMojo/agent-kernel.git}"
DIR="${DEEPWARD_DIR:-$HOME/deepward}"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=18

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n[setup stopped] %s\n' "$*" >&2; exit 1; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor
  v="$(node -v)"; v="${v#v}"; major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  [ "$major" -gt "$NODE_MIN_MAJOR" ] || { [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]; }
}

# 1. git
if ! command -v git >/dev/null 2>&1; then
  if [ "$(uname)" = "Darwin" ]; then
    xcode-select --install >/dev/null 2>&1 || true
    fail "git is missing. A macOS window should have opened to install the Command Line Tools: finish it, then run this script again."
  fi
  fail "git is missing. Install it (Ubuntu/Debian: sudo apt install git; Fedora: sudo dnf install git), then run this script again."
fi

# 2. Node >= 22.18 (installed per user through nvm when missing or too old; no admin rights needed)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
set +u  # nvm does not run under nounset
if ! node_ok && [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null 2>&1 || true; fi
if ! node_ok; then
  say "Installing Node 22 for your user account (via nvm)"
  command -v curl >/dev/null 2>&1 || fail "curl is missing. Install curl, then run this script again."
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash >/dev/null \
      || fail "Could not download nvm. Install Node 22 or newer from https://nodejs.org, then run this script again."
  fi
  . "$NVM_DIR/nvm.sh"
  nvm install 22 >/dev/null && nvm use 22 >/dev/null || fail "Could not install Node 22. Install it from https://nodejs.org, then run this script again."
  node_ok || fail "Node $(node -v) is too old; the game needs $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer."
fi
set -u
say "Node $(node -v)"

# 3. pnpm (an installed one, else corepack, else a one-off download through npm)
if command -v pnpm >/dev/null 2>&1; then
  pnpm_run() { pnpm "$@"; }
elif command -v corepack >/dev/null 2>&1 && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@9 --version >/dev/null 2>&1; then
  pnpm_run() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@9 "$@"; }
else
  pnpm_run() { npm exec --yes pnpm@9 -- "$@"; }
fi

# 4. Get or update the game. Run from inside a checkout, it uses that checkout.
SELF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$SELF_ROOT" ] && [ -f "$SELF_ROOT/scripts/game/playtest.sh" ]; then
  DIR="$SELF_ROOT"
fi
if [ -d "$DIR/.git" ]; then
  say "Updating the game in $DIR"
  if [ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
    git -C "$DIR" pull --ff-only || echo "(Could not update; playing the copy you already have.)"
  else
    echo "(You have local changes in $DIR; skipping the update.)"
  fi
else
  say "Downloading the game into $DIR"
  if ! git clone "$REPO_URL" "$DIR"; then
    cat >&2 <<MSG

[setup stopped] Could not download the game from $REPO_URL.
The repository is private, so:
  1. Ask Darren to add your GitHub account as a collaborator, and accept the invite
     (it arrives by email, or at https://github.com/KomplexMojo/agent-kernel/invitations).
  2. Sign git in to GitHub. The simplest way is the GitHub CLI: install it from https://cli.github.com,
     run 'gh auth login' and answer yes to "authenticate Git with your GitHub credentials".
     (Or, when git asks for a password, paste a personal access token from
     https://github.com/settings/tokens instead of your GitHub password.)
  3. Run this script again.
MSG
    exit 1
  fi
fi
cd "$DIR"

# 5. Packages
say "Installing the game's packages (first time takes a minute)"
pnpm_run install --frozen-lockfile || fail "Package install failed. Send Darren the messages above."

# 6. Play
REPORT_ROOT="$DIR/artifacts/playtest"
if [ "$#" -gt 0 ]; then
  bash scripts/game/playtest.sh "$@"
else
  while :; do
    echo
    bash scripts/game/playtest.sh
    echo
    read -r -p "Scenario to play (Enter for first-look, q to finish): " choice || break
    case "$choice" in
      q|Q|quit|exit) break ;;
      "") choice="first-look" ;;
    esac
    bash scripts/game/playtest.sh "$choice" || echo "(That scenario stopped with an error; please mention it in your notes.)"
  done
fi

say "Thanks for testing!"
if [ -d "$REPORT_ROOT" ]; then
  echo "Your reports are in: $REPORT_ROOT"
  echo "Send Darren every report.md in there (attach the files, or zip the folder):"
  find "$REPORT_ROOT" -name report.md -print 2>/dev/null | sort
  [ "$(uname)" = "Darwin" ] && echo "(To open the folder in Finder: open \"$REPORT_ROOT\")"
fi
echo "To play again later: bash \"$DIR/scripts/game/tester-setup.sh\""
