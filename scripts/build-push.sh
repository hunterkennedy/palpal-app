#!/usr/bin/env bash
# Build and push both images to ghcr.io.
# Usage: ./scripts/build-push.sh
# Prompts for a version, defaulting to a patch increment of the current VERSION.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="ghcr.io/hunterkennedy"

CURRENT=$(cat "${REPO_ROOT}/VERSION")

# Auto-increment patch digit as default
MAJOR=$(echo "$CURRENT" | cut -d. -f1)
MINOR=$(echo "$CURRENT" | cut -d. -f2)
PATCH=$(echo "$CURRENT" | cut -d. -f3)
DEFAULT="${MAJOR}.${MINOR}.$((PATCH + 1))"

read -rp "Version [${DEFAULT}]: " INPUT
VERSION="${INPUT:-$DEFAULT}"

echo "$VERSION" > "${REPO_ROOT}/VERSION"
echo "==> Building palpal v${VERSION}..."

docker build \
  --build-arg APP_VERSION="${VERSION}" \
  -t "${REGISTRY}/palpal-frontend:${VERSION}" \
  -t "${REGISTRY}/palpal-frontend:latest" \
  "${REPO_ROOT}/palpal-frontend"

docker build \
  -t "${REGISTRY}/palpal-conductor:${VERSION}" \
  -t "${REGISTRY}/palpal-conductor:latest" \
  "${REPO_ROOT}/palpal-conductor"

echo "==> Pushing to ghcr.io..."
docker push "${REGISTRY}/palpal-frontend:${VERSION}"
docker push "${REGISTRY}/palpal-frontend:latest"
docker push "${REGISTRY}/palpal-conductor:${VERSION}"
docker push "${REGISTRY}/palpal-conductor:latest"

echo "==> Done: ${REGISTRY}/*:${VERSION}"
