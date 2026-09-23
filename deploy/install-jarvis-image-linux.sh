#!/usr/bin/env bash
# First installation from the published GHCR image, without a source checkout.
set -Eeuo pipefail

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$root"

[[ "$(uname -s)" == "Linux" ]] || { echo "This installer runs on Linux only." >&2; exit 2; }
[[ -f compose-image.yml ]] || { echo "compose-image.yml must be beside this script." >&2; exit 2; }
[[ ! -e .env ]] || { echo ".env already exists. Use the upgrade procedure instead." >&2; exit 2; }

if [[ "${1:-}" == --dry-run && $# -eq 1 ]]; then
  printf 'Will install the published image in: %s\n' "$root"
  printf 'Will create: .env, data/, workspace/\n'
  printf 'Will start: app, worker, mcp\n'
  exit 0
fi
[[ $# -eq 0 ]] || { echo "Usage: bash install-jarvis-image-linux.sh [--dry-run]" >&2; exit 2; }

command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is unavailable." >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 2; }

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
JARVIS_IMAGE=ghcr.io/thegalitube/jarvis-mk3.1:latest
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

docker compose -f compose-image.yml --project-name jarvis-mk3-1 config --quiet
docker compose -f compose-image.yml --project-name jarvis-mk3-1 up --no-build -d --wait
curl --fail --silent --show-error http://127.0.0.1:3100/ >/dev/null

echo "J.A.R.V.I.S. Mk3.1 is ready at http://127.0.0.1:3100/"
echo "Complete the first-user setup in the browser. Keep .env private."
