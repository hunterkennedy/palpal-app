#!/usr/bin/env bash
# Deploy frontend to the frontend VPS.
# Usage: ./scripts/deploy-frontend.sh [tag]
# Requires:
#   FRONTEND_SSH       — e.g. user@vps.com
#   FRONTEND_DEPLOY_DIR — remote path containing docker-compose.frontend.yml + .env (default: /opt/palpal)
set -euo pipefail

SSH_TARGET="${FRONTEND_SSH:?Set FRONTEND_SSH (e.g. user@vps.com)}"
DEPLOY_DIR="${FRONTEND_DEPLOY_DIR:-/opt/palpal}"
TAG="${1:-latest}"

echo "==> Deploying frontend:${TAG} to ${SSH_TARGET}:${DEPLOY_DIR}..."

ssh "${SSH_TARGET}" bash -s -- "${DEPLOY_DIR}" "${TAG}" <<'REMOTE'
  set -euo pipefail
  DEPLOY_DIR="$1"
  TAG="$2"
  cd "${DEPLOY_DIR}"
  IMAGE_TAG="${TAG}" docker compose -f docker-compose.frontend.yml pull palpal-frontend
  IMAGE_TAG="${TAG}" docker compose -f docker-compose.frontend.yml up -d palpal-frontend
  docker image prune -f
  echo "Done."
REMOTE

echo "==> Frontend deployed."
