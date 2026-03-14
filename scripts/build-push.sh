#!/usr/bin/env bash
# Build and push both images to ghcr.io.
# Usage: ./scripts/build-push.sh [tag]
# Requires: GHCR_USER env var set (or export it in your shell profile)
set -euo pipefail

GHCR_USER="${GHCR_USER:?Set GHCR_USER to your GitHub username}"
TAG="${1:-latest}"
REGISTRY="ghcr.io/${GHCR_USER}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building palpal-conductor..."
docker build -t "${REGISTRY}/palpal-conductor:${TAG}" "${REPO_ROOT}/palpal-conductor"

echo "==> Building palpal-frontend..."
docker build \
  --build-arg NEXT_TELEMETRY_DISABLED=1 \
  -t "${REGISTRY}/palpal-frontend:${TAG}" \
  "${REPO_ROOT}/palpal-frontend"

echo "==> Pushing to ghcr.io..."
docker push "${REGISTRY}/palpal-conductor:${TAG}"
docker push "${REGISTRY}/palpal-frontend:${TAG}"

echo "==> Done: ${REGISTRY}/*:${TAG}"
