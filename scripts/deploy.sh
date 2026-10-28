#!/usr/bin/env bash
# Pull and deploy the production stack, authenticating to GHCR from .env.
#
# Usage:
#   ./scripts/deploy.sh
#   sudo ./scripts/deploy.sh        # if the stack runs as root
#   CONTAINER_CLI=podman ./scripts/deploy.sh
#
# Requires GHCR_USER and GHCR_TOKEN in .env (GHCR_TOKEN needs read:packages).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

read_env() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

GHCR_USER="$(read_env GHCR_USER)"
GHCR_TOKEN="$(read_env GHCR_TOKEN)"

if [[ -z "$GHCR_USER" || "$GHCR_USER" == "your-github-username" ]]; then
  echo "error: set GHCR_USER=hunterkennedy in .env" >&2
  exit 1
fi
if [[ -z "$GHCR_TOKEN" ]]; then
  echo "error: set GHCR_TOKEN to a classic PAT with read:packages in .env" >&2
  exit 1
fi

CONTAINER_CLI="${CONTAINER_CLI:-docker}"
if ! command -v "$CONTAINER_CLI" >/dev/null 2>&1; then
  echo "error: $CONTAINER_CLI not found (set CONTAINER_CLI=podman to use podman)" >&2
  exit 1
fi

# Keep the token out of the command line / process list.
printf '%s' "$GHCR_TOKEN" | "$CONTAINER_CLI" login ghcr.io -u "$GHCR_USER" --password-stdin

"$CONTAINER_CLI" compose -f docker-compose.prod.yml pull
"$CONTAINER_CLI" compose -f docker-compose.prod.yml up -d
