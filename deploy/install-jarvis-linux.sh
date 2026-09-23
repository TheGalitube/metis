#!/usr/bin/env bash
# First installation from an authenticated checkout of the private Mk3.1 repository.
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: bash deploy/install-jarvis-linux.sh [--dry-run]

Build and start the J.A.R.V.I.S. Mk3.1 workspace on a Linux host with Docker
Compose. This script creates a private .env only on the first run. It never
downloads an upstream release image and never replaces an existing install.
EOF
}

dry_run=0
case "${1:-}" in
  "") ;;
  --dry-run) dry_run=1 ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

[[ "$(uname -s)" == "Linux" ]] || { echo "This installer runs on Linux only." >&2; exit 2; }
[[ ! -e .env ]] || { echo ".env already exists. Follow docs/JARVIS-LINUX.md for a backed-up upgrade." >&2; exit 2; }

if (( dry_run )); then
  printf 'Linux first install from: %s\n' "$root"
  printf 'Will create: .env, data/, workspace/\n'
  printf 'Will run: docker compose --project-name jarvis-mk3-1 up --build -d --wait\n'
  exit 0
fi

command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker is unavailable to this user." >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "curl is required for the health check." >&2; exit 2; }

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

umask 077
mkdir -p data workspace
secrets_key="$(random_hex)"
mcp_token="$(random_hex)"
cat > .env <<EOF
APP_NAME="J.A.R.V.I.S. Mk3.1"
APP_DESCRIPTION="Private agent workspace for the J.A.R.V.I.S. Mk3 core."
AI_CHAT_HOST=127.0.0.1
AI_CHAT_BIND=127.0.0.1
PORT=3100
CHAT_USERNAME=admin
AI_CHAT_SECRETS_KEY=$secrets_key
MCP_BEARER_TOKEN=$mcp_token
MCP_ALLOW_REMOTE_ADMIN=false
MCP_ENABLE_REMOTE_SERVERS=false
MCP_ENABLE_OPTIONAL_SERVERS=false
JARVIS_ENABLE_SELF_UPDATE=0
METIS_DATA_DIR=./data
METIS_WORKSPACE=./workspace
EOF
chmod 600 .env

docker compose --project-name jarvis-mk3-1 config --quiet
docker compose --project-name jarvis-mk3-1 up --build -d --wait
curl --fail --silent --show-error http://127.0.0.1:3100/ >/dev/null

echo "J.A.R.V.I.S. Mk3.1 is ready at http://127.0.0.1:3100/"
echo "Complete the first-user setup in the browser. Keep .env private."
