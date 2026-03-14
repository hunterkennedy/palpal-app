#!/usr/bin/env bash
# Deploy conductor to the conductor server.
# Usage: ./scripts/deploy-conductor.sh [tag]
# Requires:
#   CONDUCTOR_SSH      — e.g. user@yourserver.com
#   CONDUCTOR_DEPLOY_DIR — remote path containing docker-compose.conductor.yml + .env (default: /opt/palpal)
set -euo pipefail

SSH_TARGET="${CONDUCTOR_SSH:?Set CONDUCTOR_SSH (e.g. user@yourserver.com)}"
DEPLOY_DIR="${CONDUCTOR_DEPLOY_DIR:-/opt/palpal}"
TAG="${1:-latest}"

echo "==> Deploying conductor:${TAG} to ${SSH_TARGET}:${DEPLOY_DIR}..."

ssh "${SSH_TARGET}" bash -s -- "${DEPLOY_DIR}" "${TAG}" <<'REMOTE'
  set -euo pipefail
  DEPLOY_DIR="$1"
  TAG="$2"
  cd "${DEPLOY_DIR}"
  IMAGE_TAG="${TAG}" docker compose -f docker-compose.conductor.yml pull palpal-conductor
  IMAGE_TAG="${TAG}" docker compose -f docker-compose.conductor.yml up -d palpal-conductor
  docker image prune -f
  echo "Done."
REMOTE

echo "==> Conductor deployed."
